package mail

import (
	"context"
	"math/rand"
	"time"

	"github.com/pocketbase/pocketbase"
)

const (
	domainReverifyInterval = 1 * time.Hour
	domainReverifyDelay    = 30 * time.Second
	domainReverifyJitter   = 5 * time.Minute
	domainReverifyTimeout  = 30 * time.Second
)

// startDomainReverifyLoop runs an hourly re-check of any mail_domains rows
// that are not yet fully verified. Verified rows are skipped — a user clicks
// Verify again if they change DNS after success. Cancels cleanly when ctx is
// done (hooked to OnTerminate in register.go).
func startDomainReverifyLoop(ctx context.Context, app *pocketbase.PocketBase) {
	initialDelay := domainReverifyDelay + time.Duration(rand.Int63n(int64(domainReverifyJitter)))
	timer := time.NewTimer(initialDelay)
	select {
	case <-ctx.Done():
		timer.Stop()
		return
	case <-timer.C:
	}

	reverifyUnconfirmedDomains(ctx, app)

	ticker := time.NewTicker(domainReverifyInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			reverifyUnconfirmedDomains(ctx, app)
		}
	}
}

func reverifyUnconfirmedDomains(ctx context.Context, app *pocketbase.PocketBase) {
	records, err := app.FindRecordsByFilter(
		"mail_domains",
		"verified = false",
		"",
		0,
		0,
	)
	if err != nil {
		app.Logger().Warn("mail: failed to list unverified domains for reverify", "error", err)
		return
	}
	if len(records) == 0 {
		return
	}

	app.Logger().Info("mail: reverifying unconfirmed domains", "count", len(records))
	for _, record := range records {
		if ctx.Err() != nil {
			return
		}
		runCtx, cancel := context.WithTimeout(ctx, domainReverifyTimeout)
		if _, err := verifyDomainRecord(runCtx, app, record); err != nil {
			app.Logger().Warn("mail: reverify failed",
				"domain", record.GetString("domain"),
				"error", err)
		}
		cancel()
	}
}
