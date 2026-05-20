package contacts

import (
	"strings"
	"time"

	"github.com/emersion/go-vcard"
	"github.com/pocketbase/pocketbase/core"
)

func recordToVCard(record *core.Record) vcard.Card {
	card := make(vcard.Card)
	card.SetValue(vcard.FieldVersion, "4.0")

	firstName := record.GetString("first_name")
	lastName := record.GetString("last_name")

	card.SetValue(vcard.FieldFormattedName, strings.TrimSpace(firstName+" "+lastName))
	card.Set(vcard.FieldName, &vcard.Field{
		Value: lastName + ";" + firstName + ";;;",
	})

	if uid := record.GetString("vcard_uid"); uid != "" {
		card.SetValue(vcard.FieldUID, uid)
	}

	if email := record.GetString("email"); email != "" {
		card.Set(vcard.FieldEmail, &vcard.Field{Value: email})
	}

	if phone := record.GetString("phone"); phone != "" {
		card.Set(vcard.FieldTelephone, &vcard.Field{Value: phone})
	}

	if company := record.GetString("company"); company != "" {
		card.Set(vcard.FieldOrganization, &vcard.Field{Value: company})
	}

	if title := record.GetString("job_title"); title != "" {
		card.SetValue(vcard.FieldTitle, title)
	}

	if notes := record.GetString("notes"); notes != "" {
		card.SetValue(vcard.FieldNote, notes)
	}

	if updated := record.GetString("updated"); updated != "" {
		t, err := time.Parse("2006-01-02 15:04:05.000Z", updated)
		if err == nil {
			card.SetValue(vcard.FieldRevision, t.UTC().Format("20060102T150405Z"))
		}
	}

	return card
}

func applyVCardToRecord(card vcard.Card, record *core.Record) {
	if n := card.Name(); n != nil {
		record.Set("first_name", n.GivenName)
		record.Set("last_name", n.FamilyName)
	} else if fn := card.FormattedNames(); len(fn) > 0 {
		parts := strings.SplitN(fn[0].Value, " ", 2)
		record.Set("first_name", parts[0])
		if len(parts) > 1 {
			record.Set("last_name", parts[1])
		}
	}

	if email := card.Value(vcard.FieldEmail); email != "" {
		record.Set("email", email)
	}

	if phone := card.Value(vcard.FieldTelephone); phone != "" {
		record.Set("phone", phone)
	}

	if org := card.Value(vcard.FieldOrganization); org != "" {
		record.Set("company", org)
	}

	if title := card.Value(vcard.FieldTitle); title != "" {
		record.Set("job_title", title)
	}

	if note := card.Value(vcard.FieldNote); note != "" {
		record.Set("notes", note)
	}
}
