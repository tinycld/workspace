package mail

import (
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

const (
	maxImageSize    = 10 << 20 // 10 MB
	cacheTTL        = 1 * time.Hour
	maxCacheEntries = 500
)

type cacheEntry struct {
	data        []byte
	contentType string
	expiresAt   time.Time
}

var (
	imageCache   = make(map[string]*cacheEntry)
	imageCacheMu sync.RWMutex
)

var proxyClient = &http.Client{
	Timeout: 15 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return http.ErrUseLastResponse
		}
		return nil
	},
}

// checkPrivateHost is the function used to check for private IPs.
// Tests can override this to allow loopback test servers.
var checkPrivateHost = isPrivateHost

func handleImageProxyRequest(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	token := re.Request.URL.Query().Get("token")
	if token == "" {
		return re.UnauthorizedError("missing token", nil)
	}

	_, err := app.FindAuthRecordByToken(token)
	if err != nil {
		return re.UnauthorizedError("invalid token", nil)
	}

	handleImageProxy(re.Response, re.Request)
	return nil
}

func handleImageProxy(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		http.Error(w, "missing url parameter", http.StatusBadRequest)
		return
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		http.Error(w, "invalid url", http.StatusBadRequest)
		return
	}

	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		http.Error(w, "only http/https URLs allowed", http.StatusBadRequest)
		return
	}

	host := parsed.Hostname()
	if checkPrivateHost(host) {
		http.Error(w, "private addresses not allowed", http.StatusForbidden)
		return
	}

	// Check cache
	imageCacheMu.RLock()
	if entry, ok := imageCache[rawURL]; ok && time.Now().Before(entry.expiresAt) {
		imageCacheMu.RUnlock()
		w.Header().Set("Content-Type", entry.contentType)
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.Write(entry.data)
		return
	}
	imageCacheMu.RUnlock()

	resp, err := proxyClient.Get(rawURL)
	if err != nil {
		http.Error(w, "failed to fetch image", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		http.Error(w, "upstream error", resp.StatusCode)
		return
	}

	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		http.Error(w, "not an image", http.StatusBadRequest)
		return
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImageSize+1))
	if err != nil {
		http.Error(w, "failed to read image", http.StatusBadGateway)
		return
	}
	if len(data) > maxImageSize {
		http.Error(w, "image too large", http.StatusBadRequest)
		return
	}

	// Store in cache
	imageCacheMu.Lock()
	if len(imageCache) >= maxCacheEntries {
		now := time.Now()
		for k, v := range imageCache {
			if now.After(v.expiresAt) {
				delete(imageCache, k)
			}
		}
		if len(imageCache) >= maxCacheEntries {
			for k := range imageCache {
				delete(imageCache, k)
				break
			}
		}
	}
	imageCache[rawURL] = &cacheEntry{
		data:        data,
		contentType: contentType,
		expiresAt:   time.Now().Add(cacheTTL),
	}
	imageCacheMu.Unlock()

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Write(data)
}

func isPrivateHost(host string) bool {
	ip := net.ParseIP(host)
	if ip == nil {
		addrs, err := net.LookupHost(host)
		if err != nil || len(addrs) == 0 {
			return false
		}
		ip = net.ParseIP(addrs[0])
		if ip == nil {
			return false
		}
	}

	return ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified()
}
