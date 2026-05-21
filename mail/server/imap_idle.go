package mail

import (
	"sync"
)

// idleNotifier provides a pub/sub mechanism for notifying IMAP sessions
// about mailbox changes. Sessions subscribe when entering IDLE and
// unsubscribe when IDLE ends. PocketBase record hooks publish notifications.
type idleNotifier struct {
	mu          sync.Mutex
	subscribers map[string]map[chan struct{}]struct{} // mailboxID → set of channels
}

var globalNotifier = &idleNotifier{
	subscribers: make(map[string]map[chan struct{}]struct{}),
}

// subscribe registers a channel to receive notifications for a mailbox.
func (n *idleNotifier) subscribe(mailboxID string, ch chan struct{}) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.subscribers[mailboxID] == nil {
		n.subscribers[mailboxID] = make(map[chan struct{}]struct{})
	}
	n.subscribers[mailboxID][ch] = struct{}{}
}

// unsubscribe removes a channel from notifications for a mailbox.
func (n *idleNotifier) unsubscribe(mailboxID string, ch chan struct{}) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if subs, ok := n.subscribers[mailboxID]; ok {
		delete(subs, ch)
		if len(subs) == 0 {
			delete(n.subscribers, mailboxID)
		}
	}
}

// notify sends a non-blocking signal to all subscribers of a mailbox.
func (n *idleNotifier) notify(mailboxID string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	for ch := range n.subscribers[mailboxID] {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}
