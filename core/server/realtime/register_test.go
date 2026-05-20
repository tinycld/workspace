package realtime

import "testing"

// TestShouldSkipOriginCheck pins the policy that coder/websocket's
// same-origin enforcement is bypassed for non-browser clients (empty or
// "null" Origin headers) and enforced for everything else. The realtime
// WebSocket endpoint is auth-gated on the bearer token upstream, so the
// origin check is defense-in-depth against cross-site WS hijacking from
// a browser tab — irrelevant for our WebView/RN traffic, which the
// library would otherwise reject for lacking a parseable host.
func TestShouldSkipOriginCheck(t *testing.T) {
	cases := []struct {
		name   string
		origin string
		want   bool
	}{
		// WKWebView with baseURL=about:blank (our in-WebView text editor).
		// Also matches react-native-webview HTML-mode mounts and iOS Share
		// extensions. coder/websocket parses "null" as a path with no host
		// and rejects it; we must accept it because the bearer-token auth
		// already gates the request.
		{name: "literal null from WebView", origin: "null", want: true},

		// Non-browser HTTP clients (curl, RN's native WebSocket on iOS,
		// server-to-server callers) may omit Origin entirely. http.Header.Get
		// returns "" in that case. Same reasoning as "null": token auth
		// covers it.
		{name: "absent header", origin: "", want: true},

		// Browser tabs always send a real Origin. Anything that parses to
		// a host MUST go through the library's same-origin check —
		// otherwise a logged-in user on evil.com could attach to our WS.
		{name: "real origin", origin: "https://app.example.com", want: false},
		{name: "real origin with port", origin: "http://localhost:7100", want: false},
		{name: "real cross-origin", origin: "https://evil.example.com", want: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := shouldSkipOriginCheck(tc.origin)
			if got != tc.want {
				t.Fatalf("shouldSkipOriginCheck(%q) = %v, want %v", tc.origin, got, tc.want)
			}
		})
	}
}
