package httpapi

import "net/http"

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Status  int    `json:"-"`
}

func (e apiError) WithMessage(message string) apiError {
	e.Message = message
	return e
}

var (
	errRateLimited         = apiError{Code: "rate_limited", Message: "Rate limit exceeded.", Status: http.StatusTooManyRequests}
	errInvalidSite         = apiError{Code: "invalid_site", Message: "Unknown site id.", Status: http.StatusForbidden}
	errInvalidOrigin       = apiError{Code: "invalid_origin", Message: "Origin is not allowed.", Status: http.StatusForbidden}
	errSiteRequired        = apiError{Code: "site_required", Message: "Site id is required.", Status: http.StatusBadRequest}
	errSiteLookupFailed    = apiError{Code: "site_lookup_failed", Message: "Failed to resolve site.", Status: http.StatusServiceUnavailable}
	errInvalidPayload      = apiError{Code: "invalid_payload", Message: "Request payload is invalid.", Status: http.StatusBadRequest}
	errQueueFullAPI        = apiError{Code: "queue_full", Message: "Ingest queue is full.", Status: http.StatusServiceUnavailable}
	errUnauthorized        = apiError{Code: "unauthorized", Message: "Unauthorized.", Status: http.StatusUnauthorized}
	errMetricsUnauthorized = apiError{Code: "unauthorized", Message: "Metrics token required.", Status: http.StatusUnauthorized}
)

func writeAPIError(w http.ResponseWriter, err apiError) {
	writeJSON(w, err.Status, err)
}
