package mail

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"strings"
	"time"

	gomail "github.com/emersion/go-message/mail"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// buildRFC5322 constructs a complete RFC 5322 message from a PocketBase
// mail_messages record. Handles multipart/alternative (HTML + text fallback)
// and MIME attachments.
func buildRFC5322(app *pocketbase.PocketBase, record *core.Record) ([]byte, error) {
	var buf bytes.Buffer

	// Build header
	var h gomail.Header
	h.SetDate(parseDate(record.GetString("date")))
	h.SetSubject(record.GetString("subject"))
	h.SetMessageID(record.GetString("message_id"))

	if inReplyTo := record.GetString("in_reply_to"); inReplyTo != "" {
		h.Set("In-Reply-To", inReplyTo)
		h.Set("References", inReplyTo)
	}

	senderName := record.GetString("sender_name")
	senderEmail := record.GetString("sender_email")
	h.SetAddressList("From", []*gomail.Address{{
		Name:    senderName,
		Address: senderEmail,
	}})

	toAddrs := parseRecipientAddresses(record.GetString("recipients_to"))
	if len(toAddrs) > 0 {
		h.SetAddressList("To", toAddrs)
	}

	ccAddrs := parseRecipientAddresses(record.GetString("recipients_cc"))
	if len(ccAddrs) > 0 {
		h.SetAddressList("Cc", ccAddrs)
	}

	attachmentFiles := record.GetStringSlice("attachments")
	htmlBody := loadHTMLBody(app, record)
	textBody := record.GetString("snippet")

	if len(attachmentFiles) > 0 {
		// multipart/mixed: alternative part + attachments
		mw, err := gomail.CreateWriter(&buf, h)
		if err != nil {
			return nil, fmt.Errorf("failed to create mail writer: %w", err)
		}

		if err := writeAlternativePart(mw, textBody, htmlBody); err != nil {
			return nil, err
		}

		for _, filename := range attachmentFiles {
			if err := writeAttachmentFromRecord(app, record, filename, mw); err != nil {
				app.Logger().Warn("failed to write attachment to RFC5322", "filename", filename, "error", err)
			}
		}

		mw.Close()
	} else if htmlBody != "" {
		// multipart/alternative: text + html
		mw, err := gomail.CreateWriter(&buf, h)
		if err != nil {
			return nil, fmt.Errorf("failed to create mail writer: %w", err)
		}
		if err := writeAlternativePart(mw, textBody, htmlBody); err != nil {
			return nil, err
		}
		mw.Close()
	} else {
		// Plain text only
		h.SetContentType("text/plain", map[string]string{"charset": "utf-8"})
		w, err := gomail.CreateSingleInlineWriter(&buf, h)
		if err != nil {
			return nil, fmt.Errorf("failed to create writer: %w", err)
		}
		io.WriteString(w, textBody)
		w.Close()
	}

	return buf.Bytes(), nil
}

func writeAlternativePart(mw *gomail.Writer, textBody, htmlBody string) error {
	altW, err := mw.CreateInline()
	if err != nil {
		return fmt.Errorf("failed to create alternative part: %w", err)
	}

	// text/plain part
	var textH gomail.InlineHeader
	textH.SetContentType("text/plain", map[string]string{"charset": "utf-8"})
	tw, err := altW.CreatePart(textH)
	if err != nil {
		return fmt.Errorf("failed to create text part: %w", err)
	}
	io.WriteString(tw, textBody)
	tw.Close()

	// text/html part
	if htmlBody != "" {
		var htmlH gomail.InlineHeader
		htmlH.SetContentType("text/html", map[string]string{"charset": "utf-8"})
		hw, err := altW.CreatePart(htmlH)
		if err != nil {
			return fmt.Errorf("failed to create html part: %w", err)
		}
		io.WriteString(hw, htmlBody)
		hw.Close()
	}

	altW.Close()
	return nil
}

func writeAttachmentFromRecord(app *pocketbase.PocketBase, record *core.Record, filename string, mw *gomail.Writer) error {
	fsys, err := app.NewFilesystem()
	if err != nil {
		return err
	}
	defer fsys.Close()

	key := record.BaseFilesPath() + "/" + filename
	blob, err := fsys.GetReader(key)
	if err != nil {
		return fmt.Errorf("failed to read attachment file: %w", err)
	}
	defer blob.Close()

	data, err := io.ReadAll(blob)
	if err != nil {
		return err
	}

	contentType := mime.TypeByExtension("." + fileExtension(filename))
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	var attH gomail.InlineHeader
	attH.SetContentType(contentType, map[string]string{"name": filename})
	attH.Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	attH.Set("Content-Transfer-Encoding", "base64")

	aw, err := mw.CreateSingleInline(attH)
	if err != nil {
		return err
	}
	encoder := base64.NewEncoder(base64.StdEncoding, aw)
	encoder.Write(data)
	encoder.Close()
	aw.Close()
	return nil
}

// parseRFC5322 parses an RFC 5322 message into a storedMessage struct
// for use with storeMessage(). Used by IMAP APPEND.
func parseRFC5322(raw []byte) (*storedMessage, error) {
	mr, err := gomail.CreateReader(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("failed to parse RFC 5322: %w", err)
	}

	h := mr.Header

	date, _ := h.Date()
	subject, _ := h.Subject()
	messageID, _ := h.MessageID()

	msg := &storedMessage{
		MessageID: messageID,
		Subject:   subject,
		Date:      date.UTC().Format(time.RFC3339),
	}

	if inReplyTo, err := h.MsgIDList("In-Reply-To"); err == nil && len(inReplyTo) > 0 {
		msg.InReplyTo = inReplyTo[0]
	}

	if refs, err := h.MsgIDList("References"); err == nil && len(refs) > 0 {
		msg.References = strings.Join(refs, " ")
	}

	if from, err := h.AddressList("From"); err == nil && len(from) > 0 {
		msg.SenderName = from[0].Name
		msg.SenderEmail = from[0].Address
	}

	if to, err := h.AddressList("To"); err == nil {
		for _, addr := range to {
			msg.To = append(msg.To, Recipient{Name: addr.Name, Email: addr.Address})
		}
	}

	if cc, err := h.AddressList("Cc"); err == nil {
		for _, addr := range cc {
			msg.Cc = append(msg.Cc, Recipient{Name: addr.Name, Email: addr.Address})
		}
	}

	// Parse body parts
	for {
		p, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}

		switch h := p.Header.(type) {
		case *gomail.InlineHeader:
			ct, _, _ := h.ContentType()
			body, err := io.ReadAll(p.Body)
			if err != nil {
				continue
			}
			switch {
			case strings.HasPrefix(ct, "text/html"):
				msg.HTMLBody = string(body)
			case strings.HasPrefix(ct, "text/plain"):
				msg.TextBody = string(body)
			}
		case *gomail.AttachmentHeader:
			filename, _ := h.Filename()
			body, err := io.ReadAll(p.Body)
			if err != nil {
				continue
			}
			ct, _, _ := h.ContentType()
			msg.Attachments = append(msg.Attachments, InboundAttachment{
				Name:        filename,
				ContentType: ct,
				Content:     base64.StdEncoding.EncodeToString(body),
				Size:        int64(len(body)),
			})
		}
	}

	if msg.TextBody == "" && msg.HTMLBody != "" {
		msg.TextBody = stripHTMLToText(msg.HTMLBody)
	}

	return msg, nil
}

// loadHTMLBody reads the body_html file content from a message record.
func loadHTMLBody(app *pocketbase.PocketBase, record *core.Record) string {
	htmlFile := record.GetString("body_html")
	if htmlFile == "" {
		return ""
	}

	fsys, err := app.NewFilesystem()
	if err != nil {
		return ""
	}
	defer fsys.Close()

	key := record.BaseFilesPath() + "/" + htmlFile
	blob, err := fsys.GetReader(key)
	if err != nil {
		return ""
	}
	defer blob.Close()

	data, err := io.ReadAll(blob)
	if err != nil {
		return ""
	}
	return string(data)
}

func parseDate(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Now().UTC()
	}
	return t
}

func parseRecipientAddresses(jsonStr string) []*gomail.Address {
	if jsonStr == "" || jsonStr == "[]" || jsonStr == "null" {
		return nil
	}

	var recipients []Recipient
	if err := json.Unmarshal([]byte(jsonStr), &recipients); err != nil {
		return nil
	}

	addrs := make([]*gomail.Address, 0, len(recipients))
	for _, r := range recipients {
		addrs = append(addrs, &gomail.Address{Name: r.Name, Address: r.Email})
	}
	return addrs
}

func fileExtension(filename string) string {
	dot := strings.LastIndex(filename, ".")
	if dot < 0 {
		return ""
	}
	return filename[dot+1:]
}
