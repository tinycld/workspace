package realtime

import (
	"bytes"
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// Options configures the broker. All fields have sane defaults.
type Options struct {
	// IdleTimeout closes a connection that has been idle (no read) for
	// longer than this. Zero means no idle timeout. The WebSocket
	// protocol's ping/pong frames count as activity, so a healthy
	// connection stays open indefinitely.
	IdleTimeout time.Duration

	// MaxFrameBytes is the largest single frame a client may send.
	// Frames over this size cause the connection to be closed. Zero
	// uses the package default.
	MaxFrameBytes int64

	// PingInterval is how often the broker sends a ping to each
	// client. Zero uses the package default. Disable with -1.
	PingInterval time.Duration
}

const (
	defaultIdleTimeout   = 60 * time.Second
	defaultMaxFrameBytes = 1 << 20 // 1 MiB — Yjs updates are small
	defaultPingInterval  = 25 * time.Second
)

// processBroker is the singleton Broker for this process. Created on
// first Register call. Shared across all room kinds.
var (
	processBrokerMu sync.Mutex
	processBroker   *Broker
)

func sharedBroker() *Broker {
	processBrokerMu.Lock()
	defer processBrokerMu.Unlock()
	if processBroker == nil {
		processBroker = NewBroker()
	}
	return processBroker
}

// Register mounts the realtime WebSocket route on the PocketBase app and
// readies the per-process broker. Each consuming package then calls
// RegisterRoomKind from its own server-side Register(app) to plug in its
// authorize handler.
//
// Route: GET /api/realtime/{roomKind}/{roomID}
//
// Authentication is via the standard PB session cookie or Bearer token;
// unauthenticated requests are rejected with 401. Authorization is
// delegated to the per-room-kind handler registered via RegisterRoomKind.
func Register(app *pocketbase.PocketBase, opts Options) {
	if opts.IdleTimeout == 0 {
		opts.IdleTimeout = defaultIdleTimeout
	}
	if opts.MaxFrameBytes == 0 {
		opts.MaxFrameBytes = defaultMaxFrameBytes
	}
	if opts.PingInterval == 0 {
		opts.PingInterval = defaultPingInterval
	}

	broker := sharedBroker()

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET("/api/realtime/{roomKind}/{roomID}", func(re *core.RequestEvent) error {
			return handleConnect(broker, opts, re)
		})
		return e.Next()
	})
}

func handleConnect(broker *Broker, opts Options, re *core.RequestEvent) error {
	// PocketBase's loadAuthToken middleware reads `Authorization: Bearer
	// <token>` from headers, but browsers can't set custom headers on a
	// WebSocket upgrade (`new WebSocket(url)` exposes only URL +
	// subprotocol). Fall back to `?token=<jwt>` in the query string.
	// The query-string token isn't ideal — it can show up in access
	// logs — but it's the standard pattern for browser WS auth and we
	// can revisit with Sec-WebSocket-Protocol if logging becomes a
	// concern in production.
	if re.Auth == nil {
		token := re.Request.URL.Query().Get("token")
		if token != "" {
			if record, err := re.App.FindAuthRecordByToken(token, core.TokenTypeAuth); err == nil && record != nil {
				re.Auth = record
			}
		}
	}
	if re.Auth == nil {
		return re.UnauthorizedError("Authentication required", nil)
	}

	kind := re.Request.PathValue("roomKind")
	roomID := re.Request.PathValue("roomID")
	if kind == "" || roomID == "" {
		return re.BadRequestError("roomKind and roomID required", nil)
	}

	authFn, err := authorizeFor(kind)
	if err != nil {
		return re.NotFoundError(err.Error(), nil)
	}
	if err := authFn(re.Auth, roomID); err != nil {
		return re.ForbiddenError("Not authorized for this room", err)
	}

	conn, err := websocket.Accept(re.Response, re.Request, &websocket.AcceptOptions{
		InsecureSkipVerify: shouldSkipOriginCheck(re.Request.Header.Get("Origin")),
	})
	if err != nil {
		return fmt.Errorf("websocket accept: %w", err)
	}
	conn.SetReadLimit(opts.MaxFrameBytes)

	// Once Accept succeeds, PocketBase's response writer has been
	// hijacked and we own the connection. Any error from here on is
	// reported via WS close codes, not HTTP.
	go runConnection(broker, opts, kind, roomID, re.Auth.Id, conn)
	return nil
}

// shouldSkipOriginCheck reports whether the WebSocket-upgrade handshake
// should bypass coder/websocket's same-origin check for the given
// Origin header value.
//
// Policy:
//   - Browser tabs always send a real Origin (e.g. "https://app.example").
//     For those we enforce same-origin: a logged-in user on evil.com
//     must not be able to open a WS to our backend via the user's
//     credentials.
//   - Native WebViews loaded with baseURL=about:blank (the in-WebView
//     text editor on iOS/Android), RN's WebSocket, iOS Share
//     extensions, and similar non-browser clients either omit the
//     header entirely or send the literal string "null". The bearer-
//     token auth check upstream already gates these connections on a
//     valid PocketBase token, so the origin check adds no additional
//     defense — and coder/websocket can't authorize a "null" origin
//     via OriginPatterns (its parser yields an empty host and bails).
//     Treat empty / "null" as a non-browser request and skip the check.
func shouldSkipOriginCheck(origin string) bool {
	return origin == "" || origin == "null"
}

// runConnection serves one WebSocket connection: assigns a server-side
// UUID, joins the room, sends MsgAssignID as the first frame, then
// runs read/write loops until the connection closes. Inbound frames
// must use the assigned UUID as their prefix; mismatches close the
// connection. On exit it broadcasts a leave frame keyed by the
// assigned UUID and removes the client.
//
// authID is the PocketBase user record id from the authenticated WS
// upgrade. Stored on the Client so OnConnect handlers (ServerHelloFn)
// can build per-user hello payloads (e.g. role-based read-only flags).
func runConnection(broker *Broker, opts Options, kind, roomID, authID string, conn *websocket.Conn) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	client := &Client{joinedAt: time.Now(), authID: authID}
	if _, err := rand.Read(client.id[:]); err != nil {
		// crypto/rand failure is essentially impossible on supported
		// platforms; bail rather than admit an unidentifiable client.
		_ = conn.Close(websocket.StatusInternalError, "id allocation failed")
		return
	}

	broker.join(kind, roomID, client)
	defer func() {
		room := client.room
		if room != nil {
			room.broadcastLeave(client)
			room.remove(client)
		}
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}()

	// Writer goroutine: drains client.send into the WebSocket. Exits
	// when send is closed (room.remove closes it) or when a write/ping
	// fails. On failure we cancel the connection ctx so the reader
	// loop unblocks immediately and runs the deferred cleanup —
	// otherwise a dead client would linger as a room "ghost" until
	// the IdleTimeout fires, and new joiners would defer to it for
	// the sync handshake and end up with empty state.
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		writeCtx := ctx
		ticker := time.NewTicker(opts.PingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-writeCtx.Done():
				return
			case frame, ok := <-client.send:
				if !ok {
					return
				}
				wctx, wcancel := context.WithTimeout(writeCtx, 10*time.Second)
				err := conn.Write(wctx, websocket.MessageBinary, frame)
				wcancel()
				if err != nil {
					cancel()
					return
				}
			case <-ticker.C:
				pctx, pcancel := context.WithTimeout(writeCtx, 5*time.Second)
				err := conn.Ping(pctx)
				pcancel()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()

	// First frame the client receives is its server-assigned ID. The
	// payload is empty — the routing-ID prefix IS the assignment.
	deliver(client, makeAssignFrame(client.id))

	// If this room kind registered an OnConnect handler, invoke it now
	// and deliver MsgServerHello before the sync handshake runs.
	if opts, lookupErr := optionsFor(kind); lookupErr == nil && opts.OnConnect != nil {
		payload, err := opts.OnConnect(roomID, client)
		if err != nil {
			slog.Warn(
				"realtime: OnConnect failed; skipping MsgServerHello",
				"kind", kind, "roomID", roomID, "err", err,
			)
		} else {
			deliver(client, makeServerHelloFrame(client.id, payload))
		}
	}

	// Reader loop: blocks on the connection. On any error or close,
	// returns and triggers the deferred cleanup.
	for {
		readCtx, rcancel := context.WithTimeout(ctx, opts.IdleTimeout)
		typ, data, err := conn.Read(readCtx)
		rcancel()
		if err != nil {
			cancel()
			<-writerDone
			return
		}
		if typ != websocket.MessageBinary {
			// Ignore stray text frames; protocol is binary only.
			continue
		}
		if len(data) < frameOverhead {
			cancel()
			<-writerDone
			_ = conn.Close(websocket.StatusInvalidFramePayloadData, "frame too short")
			return
		}
		// Inbound frames must use the assigned ID as their prefix.
		// A mismatch is a protocol violation: either a buggy client
		// or an attempted spoof. Either way, close the connection.
		if !bytes.Equal(data[:clientIDLen], client.id[:]) {
			cancel()
			<-writerDone
			_ = conn.Close(websocket.StatusPolicyViolation, "client id mismatch")
			return
		}
		if room := client.room; room != nil {
			room.route(client, data)
		}
	}
}

// makeAssignFrame builds the initial MsgAssignID frame the server
// sends to a new client. Wire shape: clientID(16) || msgType(1) ||
// (no payload). The presence of the assigned ID in the prefix is the
// assignment.
func makeAssignFrame(id [clientIDLen]byte) []byte {
	frame := make([]byte, frameOverhead)
	copy(frame[:clientIDLen], id[:])
	frame[clientIDLen] = byte(MsgAssignID)
	return frame
}

