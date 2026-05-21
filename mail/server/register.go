package mail

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/audit"
)

// settingsCache caches settings per org to avoid DB queries on every request.
// Invalidated by PocketBase record hooks on the settings collection.
var settingsCache sync.Map // map[string]map[string]string  (orgID → {key: value})

func Register(app *pocketbase.PocketBase) {
	// Audit logging for mail collections
	audit.RegisterCollection(app, "mail_domains", &audit.CollectionConfig{
		ExtractLabel: audit.LabelFromField("domain"),
	})

	resolveOrgViaMailbox := func(a core.App, mailboxID string) string {
		mailbox, err := a.FindRecordById("mail_mailboxes", mailboxID)
		if err != nil {
			return ""
		}
		domainID := mailbox.GetString("domain")
		if domainID == "" {
			return ""
		}
		return audit.ResolveViaRelation(a, "mail_domains", domainID, "org")
	}

	audit.RegisterCollection(app, "mail_mailboxes", &audit.CollectionConfig{
		ResolveOrg: func(a core.App, record *core.Record) string {
			domainID := record.GetString("domain")
			if domainID == "" {
				return ""
			}
			return audit.ResolveViaRelation(a, "mail_domains", domainID, "org")
		},
		ExtractLabel: audit.LabelFromField("address"),
	})

	audit.RegisterCollection(app, "mail_mailbox_members", &audit.CollectionConfig{
		ResolveOrg: func(a core.App, record *core.Record) string {
			mailboxID := record.GetString("mailbox")
			if mailboxID == "" {
				return ""
			}
			return resolveOrgViaMailbox(a, mailboxID)
		},
	})

	resolveOrgViaThread := func(a core.App, threadID string) string {
		thread, err := a.FindRecordById("mail_threads", threadID)
		if err != nil {
			return ""
		}
		mailboxID := thread.GetString("mailbox")
		if mailboxID == "" {
			return ""
		}
		return resolveOrgViaMailbox(a, mailboxID)
	}

	audit.RegisterCollection(app, "mail_messages", &audit.CollectionConfig{
		ResolveOrg: func(a core.App, record *core.Record) string {
			threadID := record.GetString("thread")
			if threadID == "" {
				return ""
			}
			return resolveOrgViaThread(a, threadID)
		},
		ExtractLabel: audit.LabelFromField("subject"),
	})

	audit.RegisterCollection(app, "mail_thread_state", &audit.CollectionConfig{
		ResolveOrg: func(a core.App, record *core.Record) string {
			threadID := record.GetString("thread")
			if threadID == "" {
				return ""
			}
			return resolveOrgViaThread(a, threadID)
		},
		ExtractLabel: audit.LabelFromField("folder"),
	})

	// Env-based provider used for unauthenticated webhooks (no org context)
	webhookProvider := newProviderFromEnv()

	// Invalidate settings cache when settings records change
	invalidateSettingsCache := func(e *core.RecordEvent) error {
		orgID := e.Record.GetString("org")
		if orgID != "" {
			settingsCache.Delete(orgID)
		}
		return e.Next()
	}
	// Auto-create personal mailbox when a user joins an org
	app.OnRecordAfterCreateSuccess("user_org").BindFunc(func(e *core.RecordEvent) error {
		handleUserOrgCreated(app, e.Record)
		return e.Next()
	})

	// Clean up orphaned personal mailboxes when a user leaves an org
	app.OnRecordAfterDeleteSuccess("user_org").BindFunc(func(e *core.RecordEvent) error {
		handleUserOrgDeleted(app, e.Record)
		return e.Next()
	})

	// Auto-generate webhook_secret for new domains
	app.OnRecordCreate("mail_domains").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("webhook_secret") == "" {
			secret, err := randomHex(16)
			if err != nil {
				return fmt.Errorf("failed to generate webhook secret: %w", err)
			}
			e.Record.Set("webhook_secret", secret)
		}
		return e.Next()
	})

	app.OnRecordAfterCreateSuccess("settings").BindFunc(invalidateSettingsCache)
	app.OnRecordAfterUpdateSuccess("settings").BindFunc(invalidateSettingsCache)
	app.OnRecordAfterDeleteSuccess("settings").BindFunc(invalidateSettingsCache)

	// FTS sync hooks for mail_threads
	app.OnRecordAfterCreateSuccess("mail_threads").BindFunc(func(e *core.RecordEvent) error {
		syncThreadToFTS(app, e.Record, "create")
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("mail_threads").BindFunc(func(e *core.RecordEvent) error {
		syncThreadToFTS(app, e.Record, "update")
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("mail_threads").BindFunc(func(e *core.RecordEvent) error {
		syncThreadToFTS(app, e.Record, "delete")
		return e.Next()
	})

	// FTS sync hooks for mail_messages
	// On create: skip if storeMessage() already indexed inline (full body + attachments).
	// Otherwise load HTML + attachments from storage for a complete index.
	app.OnRecordAfterCreateSuccess("mail_messages").BindFunc(func(e *core.RecordEvent) error {
		if _, ok := recentlyIndexed.LoadAndDelete(e.Record.Id); ok {
			return e.Next()
		}
		indexMessageRecordFromStorage(app, e.Record)
		return e.Next()
	})
	// On update: re-index from storage (e.g. draft edits via
	// updateDraftRecord). The recentlyIndexed sentinel lets follow-up
	// saves that don't change indexed content (cid_map after inbound)
	// skip a duplicate reindex.
	app.OnRecordAfterUpdateSuccess("mail_messages").BindFunc(func(e *core.RecordEvent) error {
		if _, ok := recentlyIndexed.LoadAndDelete(e.Record.Id); ok {
			return e.Next()
		}
		indexMessageRecordFromStorage(app, e.Record)
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("mail_messages").BindFunc(func(e *core.RecordEvent) error {
		deleteMessageFromFTS(app, e.Record.Id)
		return e.Next()
	})

	// IMAP IDLE notifications: notify when messages are created or thread state changes
	app.OnRecordAfterCreateSuccess("mail_messages").BindFunc(func(e *core.RecordEvent) error {
		threadID := e.Record.GetString("thread")
		thread, err := app.FindRecordById("mail_threads", threadID)
		if err == nil {
			globalNotifier.notify(thread.GetString("mailbox"))
		}
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("mail_thread_state").BindFunc(func(e *core.RecordEvent) error {
		threadID := e.Record.GetString("thread")
		thread, err := app.FindRecordById("mail_threads", threadID)
		if err == nil {
			globalNotifier.notify(thread.GetString("mailbox"))
		}
		return e.Next()
	})

	// Buffer inbound messages for batched notification delivery
	app.OnRecordAfterCreateSuccess("mail_messages").BindFunc(func(e *core.RecordEvent) error {
		go bufferMailNotification(app, e.Record)
		return e.Next()
	})

	// Generate thumbnails for any supported attachments (PDF, Office docs, HEIC).
	// AfterUpdate fires from our own Save below, so the hook short-circuits when
	// the attachments list hasn't changed since the last time we ran.
	app.OnRecordAfterCreateSuccess("mail_messages").BindFunc(func(e *core.RecordEvent) error {
		go generateAttachmentThumbnails(app, e.Record)
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("mail_messages").BindFunc(func(e *core.RecordEvent) error {
		if !attachmentsChanged(e.Record) {
			return e.Next()
		}
		go generateAttachmentThumbnails(app, e.Record)
		return e.Next()
	})

	registerAliasHooks(app)
	registerThreadMarkerHooks(app)

	audit.RegisterCollection(app, "mail_mailbox_aliases", &audit.CollectionConfig{
		ResolveOrg: func(a core.App, record *core.Record) string {
			mailboxID := record.GetString("mailbox")
			if mailboxID == "" {
				return ""
			}
			return resolveOrgViaMailbox(a, mailboxID)
		},
		ExtractLabel: audit.LabelFromField("address"),
	})

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		// Start IMAP server
		imapShutdown, err := StartIMAPServer(app, e.CertManager)
		if err != nil {
			app.Logger().Error("Failed to start IMAP server", "error", err)
		} else {
			app.OnTerminate().BindFunc(func(te *core.TerminateEvent) error {
				imapShutdown()
				return te.Next()
			})
		}

		// Start SMTP submission server
		smtpShutdown, smtpErr := StartSMTPServer(app, e.CertManager)
		if smtpErr != nil {
			app.Logger().Error("Failed to start SMTP server", "error", smtpErr)
		} else {
			app.OnTerminate().BindFunc(func(te *core.TerminateEvent) error {
				smtpShutdown()
				return te.Next()
			})
		}

		// Send endpoint (requires auth, resolves provider from org settings)
		e.Router.POST("/api/mail/send", func(re *core.RequestEvent) error {
			return handleSend(app, re)
		}).BindFunc(requireAuth)

		// Domain verification endpoint (requires auth; handler checks org admin/owner)
		e.Router.POST("/api/mail/domains/{id}/verify", func(re *core.RequestEvent) error {
			return handleVerifyDomain(app, re)
		}).BindFunc(requireAuth)

		reverifyCtx, cancelReverify := context.WithCancel(context.Background())
		app.OnTerminate().BindFunc(func(te *core.TerminateEvent) error {
			cancelReverify()
			return te.Next()
		})
		go startDomainReverifyLoop(reverifyCtx, app)

		// Draft endpoint (requires auth, saves without sending)
		e.Router.POST("/api/mail/draft", func(re *core.RequestEvent) error {
			return handleDraft(app, re)
		}).BindFunc(requireAuth)

		// Search endpoint (requires auth)
		e.Router.GET("/api/mail/search", func(re *core.RequestEvent) error {
			return handleSearch(app, re)
		}).BindFunc(requireAuth)

		// Inbound webhook (unauthenticated, secured via per-domain secret)
		e.Router.POST("/api/mail/inbound/{token}", func(re *core.RequestEvent) error {
			secret := re.Request.PathValue("token")
			if secret == "" || !isValidDomainWebhookSecret(app, secret) {
				return re.UnauthorizedError("Invalid inbound token", nil)
			}
			return handleInbound(app, webhookProvider, re, secret)
		})

		// Bounce webhook (unauthenticated, secured via per-domain secret)
		e.Router.POST("/api/mail/bounces/{token}", func(re *core.RequestEvent) error {
			secret := re.Request.PathValue("token")
			if secret == "" || !isValidDomainWebhookSecret(app, secret) {
				return re.ForbiddenError("Invalid token", nil)
			}
			return handleBounce(app, webhookProvider, re, secret)
		})

		// Webhook URLs endpoint (requires auth, returns URLs for a domain)
		e.Router.GET("/api/mail/domains/{id}/webhook-urls", func(re *core.RequestEvent) error {
			domainID := re.Request.PathValue("id")
			domain, err := app.FindRecordById("mail_domains", domainID)
			if err != nil {
				return re.NotFoundError("Domain not found", nil)
			}
			secret := domain.GetString("webhook_secret")
			baseURL := app.Settings().Meta.AppURL
			return re.JSON(http.StatusOK, map[string]string{
				"inbound": fmt.Sprintf("%s/api/mail/inbound/%s", baseURL, secret),
				"bounces": fmt.Sprintf("%s/api/mail/bounces/%s", baseURL, secret),
			})
		}).BindFunc(requireAuth)

		// Image proxy (auth via query token, since sandboxed iframes can't send headers)
		e.Router.GET("/api/mail/image-proxy", func(re *core.RequestEvent) error {
			return handleImageProxyRequest(app, re)
		})

		// Mail notification batcher: drains the per-user buffer every 2min
		// and dispatches one batched notification per user.
		go startMailBatcher(app)

		return e.Next()
	})
}

func newProviderFromEnv() Provider {
	name := os.Getenv("MAIL_PROVIDER")
	if name == "" {
		name = "postmark"
	}
	return newProviderByName(name, os.Getenv("POSTMARK_SERVER_TOKEN"), os.Getenv("POSTMARK_ACCOUNT_TOKEN"))
}

func newProviderByName(name, serverToken, accountToken string) Provider {
	switch name {
	case "postmark":
		// Return a PostmarkProvider even without a server token: ParseInbound
		// and VerifyWebhookSignature don't need it (Postmark uses URL-based
		// auth on the inbound webhook, not signed payloads), so test/dev
		// scenarios that exercise the inbound flow without real Postmark
		// credentials still work. Outbound Send() will fail at the API call
		// when the token is empty, which is the right behavior — we don't
		// want to silently drop outbound mail.
		return NewPostmarkProvider(serverToken, accountToken)
	default:
		return &NoopProvider{}
	}
}

// providerForOrg reads mail provider settings from the settings table for the
// given org, falling back to environment variables when no settings are stored.
func providerForOrg(app *pocketbase.PocketBase, orgID string) Provider {
	settings := getOrgSettings(app, "mail", orgID)

	name := settings["provider"]
	serverToken := settings["postmark_server_token"]
	accountToken := settings["postmark_account_token"]

	// Fall back to env vars when org has no settings
	if name == "" {
		name = os.Getenv("MAIL_PROVIDER")
	}
	if name == "" {
		name = "postmark"
	}
	if serverToken == "" {
		serverToken = os.Getenv("POSTMARK_SERVER_TOKEN")
	}
	if accountToken == "" {
		accountToken = os.Getenv("POSTMARK_ACCOUNT_TOKEN")
	}

	return newProviderByName(name, serverToken, accountToken)
}

// getOrgSettings returns all settings for an app+org as a key→value map.
// Results are cached in memory and invalidated by record hooks.
func getOrgSettings(app *pocketbase.PocketBase, appName, orgID string) map[string]string {
	cacheKey := orgID + ":" + appName

	if cached, ok := settingsCache.Load(cacheKey); ok {
		return cached.(map[string]string)
	}

	result := make(map[string]string)

	records, err := app.FindRecordsByFilter(
		"settings",
		"app = {:app} && org = {:org}",
		"",
		100,
		0,
		map[string]any{"app": appName, "org": orgID},
	)
	if err == nil {
		for _, r := range records {
			key := r.GetString("key")
			val := r.Get("value")
			if s, ok := val.(string); ok {
				result[key] = s
			} else if b, ok := val.(json.RawMessage); ok {
				var s string
				if json.Unmarshal(b, &s) == nil {
					result[key] = s
				}
			}
		}
	}

	settingsCache.Store(cacheKey, result)
	return result
}

// indexMessageRecordFromStorage builds FTS body_text from the record's stored
// HTML body and text-based attachments. Used by record hooks when storeMessage()
// wasn't involved or on updates.
func indexMessageRecordFromStorage(app *pocketbase.PocketBase, record *core.Record) {
	bodyText := record.GetString("snippet") // fallback

	html := loadHTMLBody(app, record)
	if html != "" {
		bodyText = stripHTMLToText(html)
	}

	attachmentText := loadTextAttachments(app, record)

	syncMessageToFTS(app, record.Id, &storedMessage{
		Subject:     record.GetString("subject"),
		SenderName:  record.GetString("sender_name"),
		SenderEmail: record.GetString("sender_email"),
		TextBody:    bodyText,
	}, attachmentText)
}

func randomHex(bytes int) (string, error) {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func isValidDomainWebhookSecret(app *pocketbase.PocketBase, secret string) bool {
	records, err := app.FindRecordsByFilter(
		"mail_domains",
		"webhook_secret = {:secret}",
		"",
		1,
		0,
		map[string]any{"secret": secret},
	)
	return err == nil && len(records) > 0
}

// requireAuth is a middleware that ensures the request has a valid auth token.
func requireAuth(re *core.RequestEvent) error {
	if re.Auth == nil {
		return re.UnauthorizedError("Authentication required", nil)
	}
	return re.Next()
}

// bufferMailNotification queues a mail notification for batched delivery.
func bufferMailNotification(app *pocketbase.PocketBase, msgRecord *core.Record) {
	// Skip outbound messages (sent by the user themselves)
	direction := msgRecord.GetString("direction")
	if direction == "outbound" || direction == "sent" {
		return
	}

	threadID := msgRecord.GetString("thread")
	if threadID == "" {
		return
	}

	thread, err := app.FindRecordById("mail_threads", threadID)
	if err != nil {
		return
	}

	mailboxID := thread.GetString("mailbox")
	if mailboxID == "" {
		return
	}

	// Find mailbox members to notify
	members, err := app.FindRecordsByFilter(
		"mail_mailbox_members",
		"mailbox = {:mailboxId}",
		"",
		0,
		0,
		map[string]any{"mailboxId": mailboxID},
	)
	if err != nil || len(members) == 0 {
		return
	}

	senderName := msgRecord.GetString("sender_name")
	senderEmail := msgRecord.GetString("sender_email")
	subject := msgRecord.GetString("subject")
	sender := senderName
	if sender == "" {
		sender = senderEmail
	}

	for _, member := range members {
		userOrgID := member.GetString("user_org")
		userOrgRecord, err := app.FindRecordById("user_org", userOrgID)
		if err != nil {
			continue
		}
		userID := userOrgRecord.GetString("user")
		orgID := userOrgRecord.GetString("org")

		bufferMailNotificationForUser(userID, orgID, sender, subject)
	}
}
