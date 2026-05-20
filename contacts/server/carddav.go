package contacts

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/emersion/go-vcard"
	"github.com/emersion/go-webdav/carddav"
	"github.com/google/uuid"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

type CardDAVBackend struct {
	app *pocketbase.PocketBase
}

func (b *CardDAVBackend) CurrentUserPrincipal(ctx context.Context) (string, error) {
	_, err := b.authFromContext(ctx)
	if err != nil {
		return "", err
	}
	return "/carddav/u/", nil
}

func (b *CardDAVBackend) AddressBookHomeSetPath(ctx context.Context) (string, error) {
	_, err := b.authFromContext(ctx)
	if err != nil {
		return "", err
	}
	return "/carddav/u/ab/", nil
}

func (b *CardDAVBackend) ListAddressBooks(ctx context.Context) ([]carddav.AddressBook, error) {
	user, err := b.authFromContext(ctx)
	if err != nil {
		return nil, err
	}

	userOrgs, err := b.app.FindRecordsByFilter("user_org", "user = {:userId}", "", 0, 0,
		map[string]any{"userId": user.Id})
	if err != nil {
		return nil, err
	}

	var books []carddav.AddressBook
	for _, uo := range userOrgs {
		orgId := uo.GetString("org")
		org, err := b.app.FindRecordById("orgs", orgId)
		if err != nil {
			continue
		}
		slug := org.GetString("slug")
		books = append(books, carddav.AddressBook{
			Path:        fmt.Sprintf("/carddav/u/ab/%s/", slug),
			Name:        org.GetString("name"),
			Description: fmt.Sprintf("Contacts for %s", org.GetString("name")),
		})
	}

	return books, nil
}

func (b *CardDAVBackend) GetAddressBook(ctx context.Context, path string) (*carddav.AddressBook, error) {
	books, err := b.ListAddressBooks(ctx)
	if err != nil {
		return nil, err
	}
	for _, book := range books {
		if book.Path == path {
			return &book, nil
		}
	}
	return nil, fmt.Errorf("address book not found")
}

func (b *CardDAVBackend) CreateAddressBook(_ context.Context, _ *carddav.AddressBook) error {
	return fmt.Errorf("creating address books is not supported")
}

func (b *CardDAVBackend) DeleteAddressBook(_ context.Context, _ string) error {
	return fmt.Errorf("deleting address books is not supported")
}

func (b *CardDAVBackend) ListAddressObjects(ctx context.Context, path string, req *carddav.AddressDataRequest) ([]carddav.AddressObject, error) {
	userOrg, err := b.resolveAddressBookOwner(ctx, path)
	if err != nil {
		return nil, err
	}

	records, err := b.app.FindRecordsByFilter("contacts", "owner = {:ownerId}", "-updated", 0, 0,
		map[string]any{"ownerId": userOrg.Id})
	if err != nil {
		return nil, err
	}

	bookPath := extractBookPath(path)
	objects := make([]carddav.AddressObject, 0, len(records))
	for _, record := range records {
		// Backfill vcard_uid for contacts created before the hook existed
		if record.GetString("vcard_uid") == "" {
			record.Set("vcard_uid", "urn:uuid:"+uuid.NewString())
			_ = b.app.Save(record)
		}
		obj, err := b.recordToAddressObject(record, bookPath, req)
		if err != nil {
			continue
		}
		objects = append(objects, *obj)
	}

	return objects, nil
}

func (b *CardDAVBackend) GetAddressObject(ctx context.Context, path string, req *carddav.AddressDataRequest) (*carddav.AddressObject, error) {
	record, bookPath, err := b.resolveContactByPath(ctx, path)
	if err != nil {
		return nil, err
	}
	return b.recordToAddressObject(record, bookPath, req)
}

func (b *CardDAVBackend) QueryAddressObjects(ctx context.Context, path string, query *carddav.AddressBookQuery) ([]carddav.AddressObject, error) {
	return b.ListAddressObjects(ctx, path, &query.DataRequest)
}

func (b *CardDAVBackend) PutAddressObject(ctx context.Context, path string, card vcard.Card, opts *carddav.PutAddressObjectOptions) (*carddav.AddressObject, error) {
	user, err := b.authFromContext(ctx)
	if err != nil {
		return nil, err
	}

	vcardUID := card.Value(vcard.FieldUID)

	// Try to find existing contact by path
	existing, bookPath, _ := b.resolveContactByPath(ctx, path)

	if existing != nil {
		applyVCardToRecord(card, existing)
		if err := b.app.Save(existing); err != nil {
			return nil, err
		}
		return b.recordToAddressObject(existing, bookPath, nil)
	}

	// Create new contact
	orgSlug := b.orgSlugFromContext(ctx, path)
	userOrg, err := b.findUserOrg(user.Id, orgSlug)
	if err != nil {
		return nil, fmt.Errorf("cannot find org membership: %w", err)
	}

	collection, err := b.app.FindCollectionByNameOrId("contacts")
	if err != nil {
		return nil, err
	}

	record := core.NewRecord(collection)
	if vcardUID == "" {
		vcardUID = "urn:uuid:" + uuid.NewString()
	}
	record.Set("vcard_uid", vcardUID)
	record.Set("owner", userOrg.Id)
	applyVCardToRecord(card, record)

	if err := b.app.Save(record); err != nil {
		return nil, err
	}

	bookPath = fmt.Sprintf("/carddav/%s/", orgSlug)
	return b.recordToAddressObject(record, bookPath, nil)
}

func (b *CardDAVBackend) DeleteAddressObject(ctx context.Context, path string) error {
	record, _, err := b.resolveContactByPath(ctx, path)
	if err != nil {
		return err
	}
	return b.app.Delete(record)
}

// authFromContext extracts the authenticated user from the request context.
func (b *CardDAVBackend) authFromContext(ctx context.Context) (*core.Record, error) {
	r, ok := ctx.Value(httpRequestKey).(*http.Request)
	if !ok {
		return nil, errUnauthorized
	}
	return authenticateRequest(b.app, r)
}

type contextKey string

const httpRequestKey contextKey = "httpRequest"

func (b *CardDAVBackend) recordToAddressObject(record *core.Record, bookPath string, _ *carddav.AddressDataRequest) (*carddav.AddressObject, error) {
	card := recordToVCard(record)

	var buf bytes.Buffer
	enc := vcard.NewEncoder(&buf)
	if err := enc.Encode(card); err != nil {
		return nil, err
	}

	modTime := time.Time{}
	if updated := record.GetString("updated"); updated != "" {
		if t, err := time.Parse("2006-01-02 15:04:05.000Z", updated); err == nil {
			modTime = t
		}
	}

	vcardUID := record.GetString("vcard_uid")
	return &carddav.AddressObject{
		Path:          bookPath + vcardUID + ".vcf",
		ModTime:       modTime,
		ContentLength: int64(buf.Len()),
		ETag:          fmt.Sprintf(`"%s"`, record.GetString("updated")),
		Card:          card,
	}, nil
}

func (b *CardDAVBackend) resolveContactByPath(ctx context.Context, path string) (*core.Record, string, error) {
	user, err := b.authFromContext(ctx)
	if err != nil {
		return nil, "", err
	}

	// Path: /carddav/{orgSlug}/{vcard_uid}.vcf
	vcardUID := extractVCardUID(path)
	if vcardUID == "" {
		return nil, "", fmt.Errorf("invalid contact path")
	}

	orgSlug := b.orgSlugFromContext(ctx, path)
	userOrg, err := b.findUserOrg(user.Id, orgSlug)
	if err != nil {
		return nil, "", err
	}

	records, err := b.app.FindRecordsByFilter("contacts", "vcard_uid = {:uid} && owner = {:ownerId}", "", 1, 0,
		map[string]any{"uid": vcardUID, "ownerId": userOrg.Id})
	if err != nil || len(records) == 0 {
		return nil, "", fmt.Errorf("contact not found")
	}

	bookPath := fmt.Sprintf("/carddav/u/ab/%s/", orgSlug)
	return records[0], bookPath, nil
}

func (b *CardDAVBackend) resolveAddressBookOwner(ctx context.Context, path string) (*core.Record, error) {
	user, err := b.authFromContext(ctx)
	if err != nil {
		return nil, err
	}
	orgSlug := b.orgSlugFromContext(ctx, path)
	return b.findUserOrg(user.Id, orgSlug)
}

func (b *CardDAVBackend) findUserOrg(userId, orgSlug string) (*core.Record, error) {
	orgs, err := b.app.FindRecordsByFilter("orgs", "slug = {:slug}", "", 1, 0,
		map[string]any{"slug": orgSlug})
	if err != nil || len(orgs) == 0 {
		return nil, fmt.Errorf("org not found: %s", orgSlug)
	}

	userOrgs, err := b.app.FindRecordsByFilter("user_org", "user = {:userId} && org = {:orgId}", "", 1, 0,
		map[string]any{"userId": userId, "orgId": orgs[0].Id})
	if err != nil || len(userOrgs) == 0 {
		return nil, fmt.Errorf("user is not a member of org %s", orgSlug)
	}

	return userOrgs[0], nil
}

// orgSlugFromContext tries the Host header subdomain first, then falls back to path-based extraction.
func (b *CardDAVBackend) orgSlugFromContext(ctx context.Context, path string) string {
	if r, ok := ctx.Value(httpRequestKey).(*http.Request); ok {
		if slug := extractOrgSlugFromHost(r.Host); slug != "" {
			return slug
		}
	}
	return extractOrgSlug(path)
}

// extractBookPath returns the address book portion of a path (up to and including the orgSlug).
func extractBookPath(path string) string {
	slug := extractOrgSlug(path)
	if slug == "" {
		return path
	}
	return fmt.Sprintf("/carddav/u/ab/%s/", slug)
}

// extractOrgSlug gets the org slug from /carddav/u/ab/{orgSlug}/...
func extractOrgSlug(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	// parts: carddav / u / ab / {orgSlug} / ...
	if len(parts) >= 4 {
		return parts[3]
	}
	return ""
}

// extractOrgSlugFromHost parses the subdomain from a Host header.
// e.g. "acme.localhost:8100" → "acme", "acme.tinycld.com" → "acme".
// Returns "" for IP addresses, bare hostnames, and two-label domains.
func extractOrgSlugFromHost(host string) string {
	// Strip port
	if idx := strings.LastIndex(host, ":"); idx != -1 {
		host = host[:idx]
	}
	// acme.localhost → acme
	if strings.HasSuffix(host, ".localhost") {
		return strings.TrimSuffix(host, ".localhost")
	}
	// IPv4 addresses look like 3+ labels split on "." but are not subdomains.
	if isIPv4(host) {
		return ""
	}
	// acme.tinycld.com → acme
	parts := strings.Split(host, ".")
	if len(parts) >= 3 {
		return parts[0]
	}
	return ""
}

// isIPv4 returns true when host is a dotted-quad like 127.0.0.1.
func isIPv4(host string) bool {
	parts := strings.Split(host, ".")
	if len(parts) != 4 {
		return false
	}
	for _, p := range parts {
		if p == "" || len(p) > 3 {
			return false
		}
		for _, c := range p {
			if c < '0' || c > '9' {
				return false
			}
		}
	}
	return true
}

// extractVCardUID gets the vcard UID from /carddav/u/ab/{orgSlug}/{vcard_uid}.vcf
func extractVCardUID(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	// parts: carddav / u / ab / {orgSlug} / {uid}.vcf
	if len(parts) >= 5 {
		return strings.TrimSuffix(parts[4], ".vcf")
	}
	return ""
}
