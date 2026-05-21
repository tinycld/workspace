package mail

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// expectedInboundMXHost is the target MX host Postmark requires for inbound
// domain forwarding. See:
// https://postmarkapp.com/developer/user-guide/inbound/inbound-domain-forwarding
const expectedInboundMXHost = "inbound.postmarkapp.com"

// mxLookup is swappable for tests.
var mxLookup = net.DefaultResolver.LookupMX

// verifyLocks serializes verify runs per mail_domains record so the hourly
// ticker and a user-triggered Verify don't write to the same row concurrently.
var verifyLocks sync.Map // recordID -> *sync.Mutex

// errProviderNotConfigured is a sentinel the endpoint can detect to return
// a targeted 400 instead of persisting misleading per-check failures when
// the org has no mail provider credentials.
var errProviderNotConfigured = errors.New("mail provider not configured")

type mxCheckResult struct {
	OK       bool     `json:"ok"`
	Expected string   `json:"expected"`
	Actual   []string `json:"actual,omitempty"`
	Error    string   `json:"error,omitempty"`
}

type postmarkCheckResult struct {
	OK             bool   `json:"ok"`
	ExpectedDomain string `json:"expected_domain,omitempty"`
	ServerDomain   string `json:"server_domain,omitempty"`
	InboundAddress string `json:"inbound_address,omitempty"`
	Error          string `json:"error,omitempty"`
}

type outboundCheckResult struct {
	SPF        bool   `json:"spf"`
	DKIM       bool   `json:"dkim"`
	ReturnPath bool   `json:"return_path"`
	Error      string `json:"error,omitempty"`
}

type verificationDetails struct {
	MX                  mxCheckResult       `json:"mx"`
	Postmark            postmarkCheckResult `json:"postmark"`
	Outbound            outboundCheckResult `json:"outbound"`
	ProviderConfigured  bool                `json:"provider_configured"`
}

// checkMX resolves MX records for the domain and matches them against the
// expected Postmark inbound host. Returns OK=true if any MX record points to
// the expected host (priority 10 is Postmark's standard; we don't require it
// strictly — any preference is accepted as long as the host matches).
func checkMX(ctx context.Context, domain string) mxCheckResult {
	result := mxCheckResult{Expected: expectedInboundMXHost}
	records, err := mxLookup(ctx, domain)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	for _, r := range records {
		host := strings.TrimSuffix(strings.ToLower(r.Host), ".")
		result.Actual = append(result.Actual, fmt.Sprintf("%s (pref %d)", host, r.Pref))
		if host == expectedInboundMXHost {
			result.OK = true
		}
	}
	if !result.OK && len(result.Actual) == 0 {
		result.Error = "no MX records found"
	}
	return result
}

// checkPostmarkServer asks the provider for its current server's InboundDomain
// and checks whether it matches the domain we're verifying. A match means the
// Postmark side of inbound forwarding is wired up for this domain.
func checkPostmarkServer(ctx context.Context, provider Provider, domain string) postmarkCheckResult {
	result := postmarkCheckResult{ExpectedDomain: domain}
	info, err := provider.CheckInboundDomain(ctx)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.ServerDomain = info.ServerInboundDomain
	result.InboundAddress = info.InboundAddress
	result.OK = strings.EqualFold(info.ServerInboundDomain, domain)
	return result
}

// checkOutbound queries the provider for SPF/DKIM/Return-Path verification.
// Failure is best-effort — missing outbound doesn't block the inbound verdict.
func checkOutbound(ctx context.Context, provider Provider, domain string) outboundCheckResult {
	result := outboundCheckResult{}
	v, err := provider.CheckDomainVerification(ctx, domain)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.SPF = v.SPFVerified
	result.DKIM = v.DKIMVerified
	result.ReturnPath = v.ReturnPathVerified
	return result
}

// recordLock returns a mutex that is unique per record ID. Callers must call
// the returned unlock func when done.
func recordLock(recordID string) func() {
	m, _ := verifyLocks.LoadOrStore(recordID, &sync.Mutex{})
	mu := m.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

// verifyDomainRecord runs all checks for a single mail_domains record, persists
// per-check status and the overall `verified` flag, and returns the details.
// `verified` is derived from inbound-readiness only (MX + Postmark InboundDomain
// match). Outbound checks are advisory. Concurrent calls on the same record
// serialize via recordLock so writes don't interleave.
func verifyDomainRecord(ctx context.Context, app *pocketbase.PocketBase, record *core.Record) (*verificationDetails, error) {
	unlock := recordLock(record.Id)
	defer unlock()

	orgID := record.GetString("org")
	domain := record.GetString("domain")

	provider := providerForOrg(app, orgID)
	_, providerConfigured := provider.(*PostmarkProvider)

	details := &verificationDetails{ProviderConfigured: providerConfigured}
	details.MX = checkMX(ctx, domain)
	details.Postmark = checkPostmarkServer(ctx, provider, domain)
	details.Outbound = checkOutbound(ctx, provider, domain)

	record.Set("mx_verified", details.MX.OK)
	record.Set("inbound_domain_verified", details.Postmark.OK)
	record.Set("spf_verified", details.Outbound.SPF)
	record.Set("dkim_verified", details.Outbound.DKIM)
	record.Set("return_path_verified", details.Outbound.ReturnPath)
	record.Set("verification_details", details)
	record.Set("last_checked_at", time.Now().UTC().Format(time.RFC3339Nano))
	record.Set("verified", details.MX.OK && details.Postmark.OK)

	if err := app.Save(record); err != nil {
		return details, err
	}
	return details, nil
}
