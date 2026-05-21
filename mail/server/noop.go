package mail

import (
	"context"
	"errors"
)

var errNoProvider = errors.New("no mail provider configured — set MAIL_PROVIDER and the corresponding credentials")

// NoopProvider returns descriptive errors for all operations.
// Used when no provider is configured so the server still boots.
type NoopProvider struct{}

func (n *NoopProvider) Send(_ context.Context, _ *SendRequest) (*SendResult, error) {
	return nil, errNoProvider
}

func (n *NoopProvider) ParseInbound(_ []byte) (*InboundMessage, error) {
	return nil, errNoProvider
}

func (n *NoopProvider) VerifyWebhookSignature(_ map[string]string, _ []byte) error {
	return errNoProvider
}

func (n *NoopProvider) ParseBounce(_ []byte) (*BounceEvent, error) {
	return nil, errNoProvider
}

func (n *NoopProvider) AddDomain(_ context.Context, _ string) (*DomainVerification, error) {
	return nil, errNoProvider
}

func (n *NoopProvider) CheckDomainVerification(_ context.Context, _ string) (*DomainVerification, error) {
	return nil, errNoProvider
}

func (n *NoopProvider) CheckInboundDomain(_ context.Context) (*InboundVerification, error) {
	return nil, errNoProvider
}
