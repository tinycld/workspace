package drive

import (
	"fmt"
	"os"

	"github.com/pocketbase/pocketbase"
)

// getUserStorageUsed returns total bytes for a user_org across drive_items + drive_item_versions.
func getUserStorageUsed(app *pocketbase.PocketBase, userOrgID string) (int64, error) {
	var result struct {
		Total int64 `db:"total"`
	}

	err := app.DB().NewQuery(`
		SELECT COALESCE(
			(SELECT SUM(size) FROM drive_items WHERE created_by = {:userOrgID}), 0
		) + COALESCE(
			(SELECT SUM(v.size) FROM drive_item_versions v
			 JOIN drive_items i ON v.item = i.id
			 WHERE v.created_by = {:userOrgID}), 0
		) AS total
	`).Bind(map[string]any{"userOrgID": userOrgID}).One(&result)
	if err != nil {
		return 0, err
	}

	return result.Total, nil
}

// getOrgStorageUsed returns (driveBytes, mailBytes) for the entire org.
func getOrgStorageUsed(app *pocketbase.PocketBase, orgID string) (int64, int64, error) {
	var driveResult struct {
		Total int64 `db:"total"`
	}
	err := app.DB().NewQuery(`
		SELECT COALESCE(
			(SELECT SUM(size) FROM drive_items WHERE org = {:orgID}), 0
		) + COALESCE(
			(SELECT SUM(v.size) FROM drive_item_versions v
			 JOIN drive_items i ON v.item = i.id
			 WHERE i.org = {:orgID}), 0
		) AS total
	`).Bind(map[string]any{"orgID": orgID}).One(&driveResult)
	if err != nil {
		return 0, 0, err
	}

	var mailResult struct {
		Total int64 `db:"total"`
	}
	err = app.DB().NewQuery(`
		SELECT COALESCE(SUM(m.total_size), 0) AS total
		FROM mail_messages m
		JOIN mail_threads t ON m.thread = t.id
		JOIN mail_mailboxes mb ON t.mailbox = mb.id
		JOIN mail_domains d ON mb.domain = d.id
		WHERE d.org = {:orgID}
	`).Bind(map[string]any{"orgID": orgID}).One(&mailResult)
	if err != nil {
		// Mail tables may not exist if package is not installed
		mailResult.Total = 0
	}

	return driveResult.Total, mailResult.Total, nil
}

// getStorageLimitBytes returns the per-user limit in bytes (0 = unlimited).
func getStorageLimitBytes(app *pocketbase.PocketBase, orgID string) int64 {
	var result struct {
		Value int64 `db:"val"`
	}
	err := app.DB().NewQuery(`
		SELECT COALESCE(CAST(value AS INTEGER), 0) AS val
		FROM settings
		WHERE app = 'core' AND key = 'storage_limit_bytes' AND org = {:orgID}
		LIMIT 1
	`).Bind(map[string]any{"orgID": orgID}).One(&result)
	if err != nil {
		return 0
	}
	return result.Value
}

// checkUserStorageQuota returns an error if the user_org would exceed its limit by adding additionalBytes.
// Returns nil if unlimited or within limit.
func checkUserStorageQuota(app *pocketbase.PocketBase, userOrgID, orgID string, additionalBytes int64) error {
	limit := getStorageLimitBytes(app, orgID)
	if limit <= 0 {
		return nil
	}

	used, err := getUserStorageUsed(app, userOrgID)
	if err != nil {
		return fmt.Errorf("failed to calculate storage usage: %w", err)
	}

	if used+additionalBytes > limit {
		available := max(limit-used, 0)
		return &errStorageLimitExceeded{
			message: fmt.Sprintf("storage limit exceeded: %s used of %s limit, %s available but %s requested",
				formatBytesHuman(used), formatBytesHuman(limit),
				formatBytesHuman(available), formatBytesHuman(additionalBytes)),
		}
	}

	return nil
}

func formatBytesHuman(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	units := []string{"KB", "MB", "GB", "TB"}
	return fmt.Sprintf("%.1f %s", float64(b)/float64(div), units[exp])
}

// errStorageLimitExceeded is a sentinel type for quota violations.
type errStorageLimitExceeded struct {
	message string
}

func (e *errStorageLimitExceeded) Error() string {
	return e.message
}

// checkUserStorageQuotaWebDAV wraps checkUserStorageQuota for use inside
// golang.org/x/net/webdav FileSystem methods.
//
// Why the wrapping shape:
//   - The stdlib handler maps PUT close errors to 405 unconditionally
//     (golang.org/x/net/webdav/webdav.go:285) — there's no clean way to
//     surface 507 Insufficient Storage. So Finder will see 405 either
//     way; the wrap exists to make errors.Is(err, os.ErrPermission) hold
//     for any other call site that wants to discriminate quota from
//     transport/IO errors.
//   - We preserve the inner error with %w so the human-readable "X used
//     of Y limit" message lands in the WebDAV Logger callback for ops
//     debugging, instead of being discarded.
func checkUserStorageQuotaWebDAV(app *pocketbase.PocketBase, userOrgID, orgID string, additionalBytes int64) error {
	if err := checkUserStorageQuota(app, userOrgID, orgID, additionalBytes); err != nil {
		return &os.PathError{Op: "write", Err: fmt.Errorf("%w: %s", os.ErrPermission, err.Error())}
	}
	return nil
}

// getUsersStorageBreakdown returns per-user_org storage usage for an org.
func getUsersStorageBreakdown(app *pocketbase.PocketBase, orgID string) ([]map[string]any, error) {
	type row struct {
		UserOrgID string `db:"user_org_id"`
		UserID    string `db:"user_id"`
		UserName  string `db:"user_name"`
		UserEmail string `db:"user_email"`
		DriveUsed int64  `db:"drive_used"`
	}

	var rows []row
	err := app.DB().NewQuery(`
		SELECT
			uo.id AS user_org_id,
			u.id AS user_id,
			u.name AS user_name,
			u.email AS user_email,
			COALESCE(di_totals.total, 0) + COALESCE(v_totals.total, 0) AS drive_used
		FROM user_org uo
		JOIN users u ON uo.user = u.id
		LEFT JOIN (
			SELECT created_by, SUM(size) AS total
			FROM drive_items
			GROUP BY created_by
		) di_totals ON di_totals.created_by = uo.id
		LEFT JOIN (
			SELECT v.created_by, SUM(v.size) AS total
			FROM drive_item_versions v
			GROUP BY v.created_by
		) v_totals ON v_totals.created_by = uo.id
		WHERE uo.org = {:orgID}
		ORDER BY drive_used DESC
	`).Bind(map[string]any{"orgID": orgID}).All(&rows)
	if err != nil {
		return nil, err
	}

	result := make([]map[string]any, len(rows))
	for i, r := range rows {
		result[i] = map[string]any{
			"user_org_id": r.UserOrgID,
			"user_id":     r.UserID,
			"user_name":   r.UserName,
			"user_email":  r.UserEmail,
			"drive_used":  r.DriveUsed,
		}
	}
	return result, nil
}
