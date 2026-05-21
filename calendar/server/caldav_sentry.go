package calendar

import (
	"context"

	"github.com/emersion/go-ical"
	"github.com/emersion/go-webdav/caldav"
	"github.com/getsentry/sentry-go"
)

// instrumentedBackend wraps a caldav.Backend so any non-nil error returned
// from a backend method is forwarded to Sentry before go-webdav swallows
// it into a generic 500 response. The router-level Sentry middleware sees
// only the response status; the actual error never reaches it because
// caldav.Handler calls http.Error(...) and returns nil. This wrapper is
// the only place we can grab the real error with its stack.
type instrumentedBackend struct {
	inner caldav.Backend
}

func newInstrumentedBackend(b caldav.Backend) caldav.Backend {
	return &instrumentedBackend{inner: b}
}

func captureCalDAVErr(ctx context.Context, op string, err error) {
	if err == nil {
		return
	}
	hub := sentry.GetHubFromContext(ctx)
	if hub == nil {
		hub = sentry.CurrentHub()
	}
	hub.WithScope(func(scope *sentry.Scope) {
		scope.SetTag("caldav.op", op)
		hub.CaptureException(err)
	})
}

func (b *instrumentedBackend) CurrentUserPrincipal(ctx context.Context) (string, error) {
	out, err := b.inner.CurrentUserPrincipal(ctx)
	captureCalDAVErr(ctx, "CurrentUserPrincipal", err)
	return out, err
}

func (b *instrumentedBackend) CalendarHomeSetPath(ctx context.Context) (string, error) {
	out, err := b.inner.CalendarHomeSetPath(ctx)
	captureCalDAVErr(ctx, "CalendarHomeSetPath", err)
	return out, err
}

func (b *instrumentedBackend) CreateCalendar(ctx context.Context, cal *caldav.Calendar) error {
	err := b.inner.CreateCalendar(ctx, cal)
	captureCalDAVErr(ctx, "CreateCalendar", err)
	return err
}

func (b *instrumentedBackend) ListCalendars(ctx context.Context) ([]caldav.Calendar, error) {
	out, err := b.inner.ListCalendars(ctx)
	captureCalDAVErr(ctx, "ListCalendars", err)
	return out, err
}

func (b *instrumentedBackend) GetCalendar(ctx context.Context, path string) (*caldav.Calendar, error) {
	out, err := b.inner.GetCalendar(ctx, path)
	captureCalDAVErr(ctx, "GetCalendar", err)
	return out, err
}

func (b *instrumentedBackend) GetCalendarObject(ctx context.Context, path string, req *caldav.CalendarCompRequest) (*caldav.CalendarObject, error) {
	out, err := b.inner.GetCalendarObject(ctx, path, req)
	captureCalDAVErr(ctx, "GetCalendarObject", err)
	return out, err
}

func (b *instrumentedBackend) ListCalendarObjects(ctx context.Context, path string, req *caldav.CalendarCompRequest) ([]caldav.CalendarObject, error) {
	out, err := b.inner.ListCalendarObjects(ctx, path, req)
	captureCalDAVErr(ctx, "ListCalendarObjects", err)
	return out, err
}

func (b *instrumentedBackend) QueryCalendarObjects(ctx context.Context, path string, query *caldav.CalendarQuery) ([]caldav.CalendarObject, error) {
	out, err := b.inner.QueryCalendarObjects(ctx, path, query)
	captureCalDAVErr(ctx, "QueryCalendarObjects", err)
	return out, err
}

func (b *instrumentedBackend) PutCalendarObject(ctx context.Context, path string, cal *ical.Calendar, opts *caldav.PutCalendarObjectOptions) (*caldav.CalendarObject, error) {
	out, err := b.inner.PutCalendarObject(ctx, path, cal, opts)
	captureCalDAVErr(ctx, "PutCalendarObject", err)
	return out, err
}

func (b *instrumentedBackend) DeleteCalendarObject(ctx context.Context, path string) error {
	err := b.inner.DeleteCalendarObject(ctx, path)
	captureCalDAVErr(ctx, "DeleteCalendarObject", err)
	return err
}
