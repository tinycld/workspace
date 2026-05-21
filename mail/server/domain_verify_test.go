package mail

import (
	"context"
	"errors"
	"net"
	"testing"
)

func withMXLookup(t *testing.T, fn func(ctx context.Context, name string) ([]*net.MX, error)) {
	t.Helper()
	orig := mxLookup
	mxLookup = fn
	t.Cleanup(func() { mxLookup = orig })
}

func TestCheckMX_MatchesPostmarkHost(t *testing.T) {
	withMXLookup(t, func(_ context.Context, _ string) ([]*net.MX, error) {
		return []*net.MX{{Host: "inbound.postmarkapp.com.", Pref: 10}}, nil
	})
	got := checkMX(context.Background(), "example.com")
	if !got.OK {
		t.Fatalf("expected MX check OK, got %+v", got)
	}
	if len(got.Actual) != 1 || got.Actual[0] != "inbound.postmarkapp.com (pref 10)" {
		t.Fatalf("expected normalized actual host with pref, got %+v", got.Actual)
	}
}

func TestCheckMX_RejectsWrongHost(t *testing.T) {
	withMXLookup(t, func(_ context.Context, _ string) ([]*net.MX, error) {
		return []*net.MX{{Host: "mail.google.com.", Pref: 10}}, nil
	})
	got := checkMX(context.Background(), "example.com")
	if got.OK {
		t.Fatalf("expected MX check to fail, got OK")
	}
}

func TestCheckMX_EmptyRecords(t *testing.T) {
	withMXLookup(t, func(_ context.Context, _ string) ([]*net.MX, error) {
		return nil, nil
	})
	got := checkMX(context.Background(), "example.com")
	if got.OK {
		t.Fatalf("expected failure on empty MX set")
	}
	if got.Error == "" {
		t.Fatalf("expected error message for empty MX set")
	}
}

func TestCheckMX_LookupError(t *testing.T) {
	withMXLookup(t, func(_ context.Context, _ string) ([]*net.MX, error) {
		return nil, errors.New("boom")
	})
	got := checkMX(context.Background(), "example.com")
	if got.OK || got.Error != "boom" {
		t.Fatalf("expected error passthrough, got %+v", got)
	}
}

func TestCheckMX_MultipleRecordsOneMatches(t *testing.T) {
	withMXLookup(t, func(_ context.Context, _ string) ([]*net.MX, error) {
		return []*net.MX{
			{Host: "alt.example.com.", Pref: 20},
			{Host: "INBOUND.POSTMARKAPP.COM.", Pref: 10},
		}, nil
	})
	got := checkMX(context.Background(), "example.com")
	if !got.OK {
		t.Fatalf("expected match on case-insensitive host; got %+v", got)
	}
}

// --- Provider check tests (pure — no DB involved) ---

type fakeProvider struct {
	inboundDomain    string
	inboundAddress   string
	inboundErr       error
	outboundSPF      bool
	outboundDKIM     bool
	outboundRP       bool
	outboundErr      error
}

func (f *fakeProvider) Send(context.Context, *SendRequest) (*SendResult, error) {
	return nil, errors.New("not implemented")
}
func (f *fakeProvider) ParseInbound([]byte) (*InboundMessage, error) {
	return nil, errors.New("not implemented")
}
func (f *fakeProvider) ParseBounce([]byte) (*BounceEvent, error) {
	return nil, errors.New("not implemented")
}
func (f *fakeProvider) VerifyWebhookSignature(map[string]string, []byte) error { return nil }
func (f *fakeProvider) AddDomain(context.Context, string) (*DomainVerification, error) {
	return nil, errors.New("not implemented")
}
func (f *fakeProvider) CheckDomainVerification(_ context.Context, _ string) (*DomainVerification, error) {
	if f.outboundErr != nil {
		return nil, f.outboundErr
	}
	return &DomainVerification{
		SPFVerified:        f.outboundSPF,
		DKIMVerified:       f.outboundDKIM,
		ReturnPathVerified: f.outboundRP,
	}, nil
}
func (f *fakeProvider) CheckInboundDomain(context.Context) (*InboundVerification, error) {
	if f.inboundErr != nil {
		return nil, f.inboundErr
	}
	return &InboundVerification{
		ServerInboundDomain: f.inboundDomain,
		InboundAddress:      f.inboundAddress,
	}, nil
}

func TestCheckPostmarkServer_CaseInsensitiveMatch(t *testing.T) {
	p := &fakeProvider{inboundDomain: "INBOUND.Example.COM", inboundAddress: "hi@inbound.example.com"}
	got := checkPostmarkServer(context.Background(), p, "inbound.example.com")
	if !got.OK {
		t.Fatalf("expected case-insensitive match; got %+v", got)
	}
	if got.InboundAddress != "hi@inbound.example.com" {
		t.Fatalf("expected inbound address surfaced; got %q", got.InboundAddress)
	}
}

func TestCheckPostmarkServer_EmptyServerDomain(t *testing.T) {
	p := &fakeProvider{inboundDomain: ""}
	got := checkPostmarkServer(context.Background(), p, "example.com")
	if got.OK {
		t.Fatalf("expected fail when server InboundDomain is empty")
	}
}

func TestCheckPostmarkServer_DomainMismatch(t *testing.T) {
	p := &fakeProvider{inboundDomain: "other.example.com"}
	got := checkPostmarkServer(context.Background(), p, "example.com")
	if got.OK {
		t.Fatalf("expected fail on domain mismatch")
	}
	if got.ServerDomain != "other.example.com" {
		t.Fatalf("expected server domain surfaced; got %q", got.ServerDomain)
	}
}

func TestCheckPostmarkServer_ProviderError(t *testing.T) {
	p := &fakeProvider{inboundErr: errors.New("403")}
	got := checkPostmarkServer(context.Background(), p, "example.com")
	if got.OK {
		t.Fatalf("expected fail on provider error")
	}
	if got.Error != "403" {
		t.Fatalf("expected error passthrough; got %q", got.Error)
	}
}

func TestCheckOutbound_AllTrue(t *testing.T) {
	p := &fakeProvider{outboundSPF: true, outboundDKIM: true, outboundRP: true}
	got := checkOutbound(context.Background(), p, "example.com")
	if !(got.SPF && got.DKIM && got.ReturnPath) {
		t.Fatalf("expected all outbound true; got %+v", got)
	}
}

func TestCheckOutbound_ProviderError(t *testing.T) {
	p := &fakeProvider{outboundErr: errors.New("domain not found")}
	got := checkOutbound(context.Background(), p, "example.com")
	if got.SPF || got.DKIM || got.ReturnPath {
		t.Fatalf("expected all outbound false on error; got %+v", got)
	}
	if got.Error != "domain not found" {
		t.Fatalf("expected error passthrough; got %q", got.Error)
	}
}
