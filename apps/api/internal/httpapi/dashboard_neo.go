package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"anlticsheat/api/internal/config"
	"anlticsheat/api/internal/storage"
)

const (
	neoMaxConversationMessages = 10
	neoMaxMessageChars         = 4000
	neoMaxToolSteps            = 6
)

var neoKnownSurfaces = []string{
	"/dashboard",
	"/map",
	"/goals",
	"/events",
	"/heatmaps",
	"/session-replay",
	"/realtime",
	"/funnels",
	"/journeys",
	"/retention",
	"/ai-insight",
	"/users",
	"/segments",
	"/alerts",
	"/integrations",
	"/settings",
}

type neoAccessMode string

const (
	neoAccessModeDashboardToken neoAccessMode = "dashboard-token"
)

type neoQueryTier string

const (
	neoQueryTierLight neoQueryTier = "light"
	neoQueryTierHeavy neoQueryTier = "heavy"
)

type neoToolAccessLevel string

const (
	neoAccessReadOnly   neoToolAccessLevel = "read-only"
	neoAccessSafeWrite  neoToolAccessLevel = "safe-write"
	neoAccessRestricted neoToolAccessLevel = "restricted"
	neoAccessForbidden  neoToolAccessLevel = "forbidden"
)

type neoChatRequest struct {
	SiteID          string           `json:"siteId"`
	Range           string           `json:"range"`
	Pathname        string           `json:"pathname"`
	Messages        []neoChatMessage `json:"messages"`
	ApprovedActions []string         `json:"approvedActions"`
	Viewer          *neoViewer       `json:"viewer,omitempty"`
}

type neoChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type neoAssistantMessage struct {
	ID        string   `json:"id"`
	Role      string   `json:"role"`
	Content   string   `json:"content"`
	CreatedAt string   `json:"createdAt"`
	ToolNames []string `json:"toolNames,omitempty"`
}

type neoViewer struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	FullName string `json:"fullName"`
}

type neoAccessContext struct {
	Mode            neoAccessMode
	Viewer          *neoViewer
	Sites           []config.Site
	CurrentSite     config.Site
	SelectedRange   storage.TimeRange
	Pathname        string
	RequestOrigin   string
	ApprovedActions map[string]struct{}
	Surfaces        []string
}

type neoRoutingDecision struct {
	Tier   neoQueryTier
	Reason string
}

type neoProviderID string

const (
	neoProviderGroq    neoProviderID = "groq"
	neoProviderLongCat neoProviderID = "longcat"
)

type neoProviderKind string

const (
	neoProviderKindGroq             neoProviderKind = "groq"
	neoProviderKindOpenAICompatible neoProviderKind = "openai-compatible"
)

type neoProviderConfig struct {
	ID              neoProviderID   `json:"id"`
	Kind            neoProviderKind `json:"kind"`
	Label           string          `json:"label"`
	BaseURL         string          `json:"baseURL"`
	APIKey          string          `json:"-"`
	Model           string          `json:"model"`
	Temperature     float64         `json:"temperature"`
	MaxTokens       int             `json:"maxTokens"`
	ReasoningEffort string          `json:"reasoningEffort,omitempty"`
}

type neoPreparedResponse struct {
	Planner         neoProviderConfig
	UsedTools       []string
	FinalMessages   []neoLLMMessage
	FallbackContent string
}

type neoLLMMessage struct {
	Role       string           `json:"role"`
	Content    any              `json:"content,omitempty"`
	Name       string           `json:"name,omitempty"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
	ToolCalls  []neoLLMToolCall `json:"tool_calls,omitempty"`
}

type neoLLMToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type neoLLMRequest struct {
	Model               string          `json:"model"`
	Messages            []neoLLMMessage `json:"messages"`
	Temperature         float64         `json:"temperature"`
	Tools               []neoToolSchema `json:"tools,omitempty"`
	ToolChoice          string          `json:"tool_choice,omitempty"`
	MaxTokens           int             `json:"max_tokens,omitempty"`
	MaxCompletionTokens int             `json:"max_completion_tokens,omitempty"`
	TopP                float64         `json:"top_p,omitempty"`
	ReasoningEffort     string          `json:"reasoning_effort,omitempty"`
}

type neoLLMResponse struct {
	Choices []struct {
		Message neoLLMMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type neoToolSchema struct {
	Type     string                `json:"type"`
	Function neoToolFunctionSchema `json:"function"`
}

type neoToolFunctionSchema struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

type neoToolDescriptor struct {
	Name                 string             `json:"name"`
	Category             string             `json:"category"`
	Access               neoToolAccessLevel `json:"access"`
	Description          string             `json:"description"`
	StructuredOutput     bool               `json:"structuredOutput"`
	RequiresConfirmation bool               `json:"requiresConfirmation"`
	Logged               bool               `json:"logged"`
	Parameters           map[string]any     `json:"parameters"`
}

type neoToolEntry struct {
	Schema     neoToolSchema
	Descriptor neoToolDescriptor
	Execute    func(context.Context, *neoAccessContext, map[string]any) (neoToolResult, error)
}

type neoToolResult struct {
	OK           bool               `json:"ok"`
	Tool         string             `json:"tool"`
	Access       neoToolAccessLevel `json:"access"`
	Summary      string             `json:"summary"`
	Highlights   []string           `json:"highlights,omitempty"`
	Freshness    string             `json:"freshness,omitempty"`
	Confidence   string             `json:"confidence,omitempty"`
	Privacy      string             `json:"privacy,omitempty"`
	Scope        map[string]any     `json:"scope,omitempty"`
	Data         any                `json:"data,omitempty"`
	Error        string             `json:"error,omitempty"`
	Confirmation *neoConfirmation   `json:"confirmation,omitempty"`
}

type neoConfirmation struct {
	Required    bool   `json:"required"`
	ApprovalKey string `json:"approvalKey"`
	Reason      string `json:"reason"`
}

type neoActionLog struct {
	ActionKey      string
	SiteID         string
	ActorUserID    string
	ActionType     string
	ActionLevel    neoToolAccessLevel
	TargetType     string
	TargetID       string
	Status         string
	Summary        string
	RequestPayload map[string]any
	ResultPayload  map[string]any
}

type neoStreamEvent struct {
	Type      string               `json:"type"`
	Value     string               `json:"value,omitempty"`
	ToolNames []string             `json:"toolNames,omitempty"`
	Text      string               `json:"text,omitempty"`
	Message   *neoAssistantMessage `json:"message,omitempty"`
	Error     string               `json:"error,omitempty"`
}

type neoForbiddenResult struct {
	Matched bool
	Subject string
	Steps   []string
}

func (s *Server) handleDashboardNeoTools(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}

	registry := s.neoToolRegistry()
	tools := make([]neoToolDescriptor, 0, len(registry))
	for _, entry := range registry {
		tools = append(tools, entry.Descriptor)
	}
	slices.SortFunc(tools, func(a, b neoToolDescriptor) int {
		return strings.Compare(a.Name, b.Name)
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"providers": s.neoAvailableProviderMetadata(),
		"security": map[string]any{
			"readOnly":   "Analytics and configuration reads run without confirmation and never expose personal identifiers.",
			"safeWrite":  "Profile updates, privacy changes, and tracker regeneration are logged before returning success.",
			"restricted": "Billing remediation and customer-service handoffs require explicit approval via approvedActions.",
			"forbidden":  []string{"delete user account", "delete site", "delete profile"},
		},
		"forbiddenActionGuidance": map[string][]string{
			"account": {"Open /settings, choose the account/profile area, and use the delete-account control there.", "Neo can explain the consequences, but it will not perform the deletion."},
			"site":    {"Open /settings, select the site you want to remove, and use the delete-site control in the site settings flow.", "Neo can verify tracking is off first, but it will not delete the site itself."},
			"profile": {"Open /settings, go to your profile section, and use the profile deletion or removal control there.", "Neo can help rename or update the profile, but deletion stays manual."},
		},
		"tools": tools,
	})
}

func (s *Server) handleDashboardNeoChat(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}

	var request neoChatRequest
	if err := decodeJSON(w, r, 64<<10, &request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	conversation := sanitizeNeoConversation(request.Messages)
	if len(conversation) == 0 || conversation[len(conversation)-1].Role != "user" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "send a user message to Neo"})
		return
	}

	accessContext, err := s.resolveNeoAccessContext(r, request)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")

	emit := func(event neoStreamEvent) {
		payload, marshalErr := json.Marshal(event)
		if marshalErr != nil {
			return
		}
		_, _ = w.Write(append(payload, '\n'))
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
	}

	emit(neoStreamEvent{Type: "status", Value: "loading"})

	lastUserMessage := conversation[len(conversation)-1].Content
	if forbidden := detectForbiddenNeoAction(lastUserMessage); forbidden.Matched {
		emit(neoStreamEvent{Type: "status", Value: "streaming"})
		reply := buildForbiddenNeoReply(forbidden)
		for _, chunk := range chunkNeoText(reply) {
			emit(neoStreamEvent{Type: "delta", Text: chunk})
		}
		emit(neoStreamEvent{
			Type: "done",
			Message: &neoAssistantMessage{
				ID:        neoID("msg", reply),
				Role:      "assistant",
				Content:   reply,
				CreatedAt: time.Now().UTC().Format(time.RFC3339),
			},
		})
		return
	}

	registry := s.neoProviderRegistry()
	planners := neoPlannerProviders(registry)
	synthesis := neoSynthesisProviders(classifyNeoConversation(conversation), registry)
	if len(planners) == 0 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "neo is not configured"})
		return
	}

	var prepared *neoPreparedResponse
	var lastPlannerErr error
	for _, planner := range planners {
		candidate, prepErr := s.prepareNeoResponse(r.Context(), conversation, accessContext, planner)
		if prepErr == nil {
			prepared = &candidate
			break
		}
		lastPlannerErr = prepErr
	}
	if prepared == nil {
		emit(neoStreamEvent{Type: "error", Error: neoErrorMessage(lastPlannerErr, "Neo could not prepare a response.")})
		return
	}

	if len(prepared.UsedTools) > 0 {
		emit(neoStreamEvent{Type: "meta", ToolNames: prepared.UsedTools})
	}
	emit(neoStreamEvent{Type: "status", Value: "streaming"})

	content, synthErr := s.synthesizeNeoReply(r.Context(), *prepared, synthesis)
	if synthErr != nil && strings.TrimSpace(prepared.FallbackContent) == "" {
		emit(neoStreamEvent{Type: "error", Error: neoErrorMessage(synthErr, "Neo could not generate a response.")})
		return
	}
	if strings.TrimSpace(content) == "" {
		content = strings.TrimSpace(prepared.FallbackContent)
	}

	for _, chunk := range chunkNeoText(content) {
		emit(neoStreamEvent{Type: "delta", Text: chunk})
	}
	emit(neoStreamEvent{
		Type: "done",
		Message: &neoAssistantMessage{
			ID:        neoID("msg", content),
			Role:      "assistant",
			Content:   content,
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
			ToolNames: prepared.UsedTools,
		},
	})
}

func sanitizeNeoConversation(messages []neoChatMessage) []neoChatMessage {
	safe := make([]neoChatMessage, 0, len(messages))
	for _, message := range messages {
		role := strings.TrimSpace(strings.ToLower(message.Role))
		if role != "user" && role != "assistant" {
			continue
		}
		content := truncateNeoText(message.Content, neoMaxMessageChars)
		if content == "" {
			continue
		}
		safe = append(safe, neoChatMessage{Role: role, Content: content})
	}
	if len(safe) > neoMaxConversationMessages {
		safe = safe[len(safe)-neoMaxConversationMessages:]
	}
	return safe
}

func truncateNeoText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[:limit]
}

func (s *Server) resolveNeoAccessContext(r *http.Request, request neoChatRequest) (*neoAccessContext, error) {
	sites, err := s.sites.ListSites(r.Context())
	if err != nil {
		return nil, fmt.Errorf("failed to list accessible sites: %w", err)
	}
	if len(sites) == 0 {
		return nil, errors.New("no accessible sites are available")
	}

	currentSite := sites[0]
	requestedSiteID := strings.TrimSpace(request.SiteID)
	if requestedSiteID != "" {
		for _, site := range sites {
			if site.ID == requestedSiteID {
				currentSite = site
				break
			}
		}
	}

	approved := make(map[string]struct{}, len(request.ApprovedActions))
	for _, key := range request.ApprovedActions {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		approved[key] = struct{}{}
	}

	viewer := request.Viewer
	if viewer != nil {
		viewer.ID = strings.TrimSpace(viewer.ID)
		viewer.Email = strings.TrimSpace(strings.ToLower(viewer.Email))
		viewer.FullName = strings.TrimSpace(viewer.FullName)
		if viewer.ID == "" {
			viewer = nil
		}
	}

	return &neoAccessContext{
		Mode:            neoAccessModeDashboardToken,
		Viewer:          viewer,
		Sites:           sites,
		CurrentSite:     currentSite,
		SelectedRange:   storage.ParseTimeRange(request.Range),
		Pathname:        truncateNeoText(firstNonEmpty(request.Pathname, "/dashboard"), 120),
		RequestOrigin:   requestBaseURL(r),
		ApprovedActions: approved,
		Surfaces:        slices.Clone(neoKnownSurfaces),
	}, nil
}

func (s *Server) neoProviderRegistry() []neoProviderConfig {
	providers := []neoProviderConfig{}
	if strings.TrimSpace(s.cfg.NeoGroqAPIKey) != "" {
		providers = append(providers, neoProviderConfig{
			ID:              neoProviderGroq,
			Kind:            neoProviderKindGroq,
			Label:           "Groq",
			BaseURL:         strings.TrimRight(strings.TrimSpace(s.cfg.NeoGroqBaseURL), "/"),
			APIKey:          strings.TrimSpace(s.cfg.NeoGroqAPIKey),
			Model:           strings.TrimSpace(s.cfg.NeoGroqModel),
			Temperature:     s.cfg.NeoGroqTemperature,
			MaxTokens:       s.cfg.NeoGroqMaxTokens,
			ReasoningEffort: strings.TrimSpace(s.cfg.NeoGroqReasoningEffort),
		})
	}
	if strings.TrimSpace(s.cfg.NeoLongCatAPIKey) != "" {
		providers = append(providers, neoProviderConfig{
			ID:          neoProviderLongCat,
			Kind:        neoProviderKindOpenAICompatible,
			Label:       "LongCat",
			BaseURL:     strings.TrimRight(strings.TrimSpace(s.cfg.NeoLongCatBaseURL), "/"),
			APIKey:      strings.TrimSpace(s.cfg.NeoLongCatAPIKey),
			Model:       strings.TrimSpace(s.cfg.NeoLongCatModel),
			Temperature: s.cfg.NeoLongCatTemperature,
			MaxTokens:   s.cfg.NeoLongCatMaxTokens,
		})
	}
	return providers
}

func (s *Server) neoAvailableProviderMetadata() []map[string]any {
	providers := s.neoProviderRegistry()
	metadata := make([]map[string]any, 0, len(providers))
	for _, provider := range providers {
		metadata = append(metadata, map[string]any{
			"id":    provider.ID,
			"label": provider.Label,
			"kind":  provider.Kind,
			"model": provider.Model,
		})
	}
	return metadata
}

func neoPlannerProviders(registry []neoProviderConfig) []neoProviderConfig {
	ordered := []neoProviderConfig{}
	if provider, ok := neoFindProvider(registry, neoProviderGroq); ok {
		ordered = append(ordered, provider)
	}
	if provider, ok := neoFindProvider(registry, neoProviderLongCat); ok {
		ordered = append(ordered, provider)
	}
	return ordered
}

func neoSynthesisProviders(decision neoRoutingDecision, registry []neoProviderConfig) []neoProviderConfig {
	ordered := []neoProviderConfig{}
	switch decision.Tier {
	case neoQueryTierHeavy:
		if provider, ok := neoFindProvider(registry, neoProviderLongCat); ok {
			ordered = append(ordered, provider)
		}
		if provider, ok := neoFindProvider(registry, neoProviderGroq); ok {
			ordered = append(ordered, provider)
		}
	default:
		if provider, ok := neoFindProvider(registry, neoProviderGroq); ok {
			ordered = append(ordered, provider)
		}
		if provider, ok := neoFindProvider(registry, neoProviderLongCat); ok {
			ordered = append(ordered, provider)
		}
	}
	return ordered
}

func neoFindProvider(registry []neoProviderConfig, id neoProviderID) (neoProviderConfig, bool) {
	for _, provider := range registry {
		if provider.ID == id {
			return provider, true
		}
	}
	return neoProviderConfig{}, false
}

func classifyNeoConversation(conversation []neoChatMessage) neoRoutingDecision {
	last := ""
	for index := len(conversation) - 1; index >= 0; index-- {
		if conversation[index].Role == "user" {
			last = conversation[index].Content
			break
		}
	}
	normalized := strings.ToLower(last)
	wordCount := len(strings.Fields(normalized))
	heavyTerms := []string{"analyse", "analysis", "summarize", "summary", "compare", "trend", "insight", "report", "audit", "review", "explain", "what happened"}
	lightTerms := []string{"profile", "rename", "change my name", "tracker snippet", "install snippet", "code snippet"}
	for _, term := range lightTerms {
		if strings.Contains(normalized, term) {
			return neoRoutingDecision{Tier: neoQueryTierLight, Reason: "short operational request"}
		}
	}
	for _, term := range heavyTerms {
		if strings.Contains(normalized, term) {
			return neoRoutingDecision{Tier: neoQueryTierHeavy, Reason: "analysis intent"}
		}
	}
	if len(last) >= 220 || wordCount >= 36 {
		return neoRoutingDecision{Tier: neoQueryTierHeavy, Reason: "long-form prompt"}
	}
	return neoRoutingDecision{Tier: neoQueryTierLight, Reason: "default light request"}
}

func (s *Server) prepareNeoResponse(
	ctx context.Context,
	conversation []neoChatMessage,
	accessContext *neoAccessContext,
	planner neoProviderConfig,
) (neoPreparedResponse, error) {
	messages := []neoLLMMessage{{Role: "system", Content: s.buildNeoSystemPrompt(accessContext)}}
	for _, message := range conversation {
		messages = append(messages, neoLLMMessage{
			Role:    message.Role,
			Content: message.Content,
		})
	}

	registry := s.neoToolRegistry()
	toolNames := make([]string, 0, len(registry))
	for name := range registry {
		toolNames = append(toolNames, name)
	}
	slices.Sort(toolNames)
	tools := make([]neoToolSchema, 0, len(toolNames))
	for _, name := range toolNames {
		tools = append(tools, registry[name].Schema)
	}

	usedTools := []string{}
	for step := 0; step < neoMaxToolSteps; step++ {
		response, err := s.callNeoProvider(ctx, messages, planner, tools)
		if err != nil {
			return neoPreparedResponse{}, err
		}
		if len(response.Choices) == 0 {
			return neoPreparedResponse{}, errors.New("neo returned no completion choices")
		}

		assistant := response.Choices[0].Message
		if len(assistant.ToolCalls) == 0 {
			content := sanitizeNeoAssistantContent(extractNeoTextContent(assistant.Content))
			if content == "" {
				return neoPreparedResponse{}, errors.New("neo returned an empty response")
			}
			return neoPreparedResponse{
				Planner:         planner,
				UsedTools:       dedupeNeoToolNames(usedTools),
				FinalMessages:   messages,
				FallbackContent: content,
			}, nil
		}

		messages = append(messages, neoLLMMessage{
			Role:      "assistant",
			Content:   sanitizeNeoAssistantContent(extractNeoTextContent(assistant.Content)),
			ToolCalls: assistant.ToolCalls,
		})

		for _, call := range assistant.ToolCalls {
			toolName := strings.TrimSpace(call.Function.Name)
			args := parseNeoToolArgs(call.Function.Arguments)
			result, execErr := s.executeNeoTool(ctx, registry, toolName, accessContext, args)
			if execErr != nil {
				result = neoToolResult{
					OK:      false,
					Tool:    toolName,
					Access:  neoAccessReadOnly,
					Summary: "Tool execution failed.",
					Error:   execErr.Error(),
				}
			}

			usedTools = append(usedTools, toolName)
			payload, _ := json.Marshal(result)
			messages = append(messages, neoLLMMessage{
				Role:       "tool",
				ToolCallID: call.ID,
				Name:       toolName,
				Content:    string(payload),
			})
		}
	}

	return neoPreparedResponse{}, errors.New("neo reached its tool-call limit before producing a final answer")
}

func (s *Server) synthesizeNeoReply(
	ctx context.Context,
	prepared neoPreparedResponse,
	providers []neoProviderConfig,
) (string, error) {
	if len(providers) == 0 {
		return sanitizeNeoAssistantContent(prepared.FallbackContent), nil
	}

	var lastErr error
	for _, provider := range providers {
		response, err := s.callNeoProvider(ctx, prepared.FinalMessages, provider, nil)
		if err != nil {
			lastErr = err
			continue
		}
		if len(response.Choices) == 0 {
			lastErr = errors.New("neo synthesis returned no choices")
			continue
		}
		content := sanitizeNeoAssistantContent(extractNeoTextContent(response.Choices[0].Message.Content))
		if content != "" {
			return content, nil
		}
		lastErr = errors.New("neo synthesis returned an empty response")
	}

	if fallback := sanitizeNeoAssistantContent(prepared.FallbackContent); fallback != "" {
		return fallback, nil
	}
	return "", lastErr
}

func (s *Server) callNeoProvider(
	ctx context.Context,
	messages []neoLLMMessage,
	provider neoProviderConfig,
	tools []neoToolSchema,
) (neoLLMResponse, error) {
	request := neoLLMRequest{
		Model:       provider.Model,
		Messages:    messages,
		Temperature: provider.Temperature,
	}
	switch provider.Kind {
	case neoProviderKindGroq:
		request.TopP = 0.95
		request.MaxCompletionTokens = provider.MaxTokens
		request.ReasoningEffort = provider.ReasoningEffort
	default:
		request.MaxTokens = provider.MaxTokens
	}
	if len(tools) > 0 {
		request.Tools = tools
		request.ToolChoice = "auto"
	}

	body, err := json.Marshal(request)
	if err != nil {
		return neoLLMResponse{}, err
	}

	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		strings.TrimRight(provider.BaseURL, "/")+"/chat/completions",
		strings.NewReader(string(body)),
	)
	if err != nil {
		return neoLLMResponse{}, err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", "Bearer "+provider.APIKey)

	client := &http.Client{Timeout: 30 * time.Second}
	response, err := client.Do(httpRequest)
	if err != nil {
		return neoLLMResponse{}, err
	}
	defer response.Body.Close()

	var payload neoLLMResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return neoLLMResponse{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if payload.Error != nil && strings.TrimSpace(payload.Error.Message) != "" {
			return neoLLMResponse{}, errors.New(strings.TrimSpace(payload.Error.Message))
		}
		return neoLLMResponse{}, fmt.Errorf("%s provider returned %d", provider.Label, response.StatusCode)
	}
	return payload, nil
}

func extractNeoTextContent(content any) string {
	switch value := content.(type) {
	case string:
		return value
	case []any:
		parts := make([]string, 0, len(value))
		for _, part := range value {
			object, ok := part.(map[string]any)
			if !ok {
				continue
			}
			if text, ok := object["text"].(string); ok {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	default:
		return ""
	}
}

func sanitizeNeoAssistantContent(input string) string {
	output := strings.TrimSpace(input)
	replacements := []string{"<think>", "</think>", "<thinking>", "</thinking>"}
	for _, replacement := range replacements {
		output = strings.ReplaceAll(output, replacement, "")
	}
	output = strings.ReplaceAll(output, "Reasoning:", "")
	output = strings.ReplaceAll(output, "Thought process:", "")
	output = strings.ReplaceAll(output, "thinking:", "")
	for strings.Contains(output, "\n\n\n") {
		output = strings.ReplaceAll(output, "\n\n\n", "\n\n")
	}
	return strings.TrimSpace(output)
}

func dedupeNeoToolNames(names []string) []string {
	seen := map[string]struct{}{}
	deduped := make([]string, 0, len(names))
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		deduped = append(deduped, name)
	}
	return deduped
}

func chunkNeoText(content string) []string {
	words := strings.Fields(content)
	if len(words) == 0 {
		return nil
	}
	chunks := []string{}
	current := ""
	for _, word := range words {
		piece := word
		if current != "" {
			piece = current + " " + word
		}
		if len(piece) > 40 && current != "" {
			chunks = append(chunks, current+" ")
			current = word
			continue
		}
		current = piece
	}
	if strings.TrimSpace(current) != "" {
		chunks = append(chunks, current)
	}
	return chunks
}

func (s *Server) buildNeoSystemPrompt(context *neoAccessContext) string {
	currentSite := neoLabelForSite(context.CurrentSite)
	return strings.Join([]string{
		"You are Neo, the in-product analytics copilot for AnlticsHeat.",
		"Use tools for metrics, configuration, diagnostics, and approved operational actions.",
		"Never invent metrics, snippets, integrations, refunds, or account details.",
		"Use only structured tool outputs. Do not ask for raw event payloads, replay video, DOM snapshots, identifiers, IPs, cookies, or free-text form content.",
		"Keep answers concise, practical, and grounded in the returned data.",
		"Current dashboard path: " + context.Pathname + ".",
		"Selected site: " + currentSite + " (" + context.CurrentSite.ID + ").",
		"Selected range: " + context.SelectedRange.String() + ".",
		"Available surfaces: " + strings.Join(context.Surfaces, ", ") + ".",
		"Forbidden actions: delete account, delete site, delete profile. When asked, explain the manual steps instead of calling a tool.",
		"Restricted actions require explicit approval. If a tool returns confirmation.required, ask the user to confirm first.",
		"Only use update_profile_name when the user explicitly asks to rename their profile.",
		"If the user asks for the exact tracker snippet, use get_tracker_installation and return the snippet in a fenced code block.",
		"Do not reveal chain-of-thought or reasoning traces.",
	}, " ")
}

func neoLabelForSite(site config.Site) string {
	if strings.TrimSpace(site.Name) != "" && site.Name != site.ID {
		return strings.TrimSpace(site.Name)
	}
	if len(site.Origins) > 0 && strings.TrimSpace(site.Origins[0]) != "" {
		origin := strings.TrimSpace(site.Origins[0])
		origin = strings.TrimPrefix(origin, "https://")
		origin = strings.TrimPrefix(origin, "http://")
		origin = strings.TrimPrefix(origin, "www.")
		return origin
	}
	return site.ID
}

func parseNeoToolArgs(raw string) map[string]any {
	if strings.TrimSpace(raw) == "" {
		return map[string]any{}
	}
	args := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &args); err != nil {
		return map[string]any{}
	}
	return args
}

func (s *Server) executeNeoTool(
	ctx context.Context,
	registry map[string]neoToolEntry,
	toolName string,
	accessContext *neoAccessContext,
	args map[string]any,
) (neoToolResult, error) {
	entry, ok := registry[toolName]
	if !ok {
		return neoToolResult{}, fmt.Errorf("unknown tool %q", toolName)
	}
	result, err := entry.Execute(ctx, accessContext, args)
	if err != nil {
		return neoToolResult{
			OK:      false,
			Tool:    toolName,
			Access:  entry.Descriptor.Access,
			Summary: "Neo could not execute the requested tool.",
			Error:   err.Error(),
		}, nil
	}
	result.Tool = toolName
	result.Access = entry.Descriptor.Access
	return result, nil
}

func detectForbiddenNeoAction(message string) neoForbiddenResult {
	normalized := strings.ToLower(strings.TrimSpace(message))
	if normalized == "" {
		return neoForbiddenResult{}
	}
	deleteTerms := []string{"delete", "remove", "destroy"}
	hasDeleteTerm := false
	for _, term := range deleteTerms {
		if strings.Contains(normalized, term) {
			hasDeleteTerm = true
			break
		}
	}
	if !hasDeleteTerm {
		return neoForbiddenResult{}
	}

	switch {
	case strings.Contains(normalized, "account"):
		return neoForbiddenResult{
			Matched: true,
			Subject: "account",
			Steps: []string{
				"Open /settings.",
				"Go to the account or profile section.",
				"Use the delete-account control there and review the confirmation prompts.",
			},
		}
	case strings.Contains(normalized, "profile"):
		return neoForbiddenResult{
			Matched: true,
			Subject: "profile",
			Steps: []string{
				"Open /settings.",
				"Go to the profile section.",
				"Use the profile deletion or removal control there and follow the confirmation flow.",
			},
		}
	case strings.Contains(normalized, "site"):
		return neoForbiddenResult{
			Matched: true,
			Subject: "site",
			Steps: []string{
				"Open /settings.",
				"Select the site you want to remove.",
				"Use the delete-site control in the site settings flow and confirm the removal there.",
			},
		}
	default:
		return neoForbiddenResult{}
	}
}

func buildForbiddenNeoReply(result neoForbiddenResult) string {
	lines := []string{
		"Neo will not perform that deletion directly.",
		"Use the manual flow instead:",
	}
	for _, step := range result.Steps {
		lines = append(lines, "- "+step)
	}
	lines = append(lines, "I can still help you verify the impact first, such as checking tracker health, recent data, or configuration state.")
	return strings.Join(lines, "\n")
}

func neoErrorMessage(err error, fallback string) string {
	if err == nil {
		return fallback
	}
	if strings.TrimSpace(err.Error()) == "" {
		return fallback
	}
	return err.Error()
}

func neoID(prefix, seed string) string {
	sum := sha256.Sum256([]byte(prefix + ":" + seed))
	return prefix + "_" + hex.EncodeToString(sum[:])[:12]
}

func neoStringArg(args map[string]any, key string) string {
	value, ok := args[key]
	if !ok {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		return strings.TrimSpace(strconv.FormatFloat(typed, 'f', -1, 64))
	default:
		return ""
	}
}

func neoBoolArg(args map[string]any, key string, fallback bool) bool {
	value, ok := args[key]
	if !ok {
		return fallback
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		default:
			return fallback
		}
	default:
		return fallback
	}
}

func neoIntArg(args map[string]any, key string, fallback int) int {
	value, ok := args[key]
	if !ok {
		return fallback
	}
	switch typed := value.(type) {
	case float64:
		return int(math.Round(typed))
	case string:
		if parsed, err := strconv.Atoi(strings.TrimSpace(typed)); err == nil {
			return parsed
		}
	}
	return fallback
}

func neoApprovalKey(toolName, siteID string, args map[string]any) string {
	payload, _ := json.Marshal(args)
	sum := sha256.Sum256([]byte(toolName + ":" + siteID + ":" + string(payload)))
	return "approval_" + hex.EncodeToString(sum[:])[:16]
}

func (s *Server) requireNeoApproval(
	ctx context.Context,
	accessContext *neoAccessContext,
	toolName string,
	args map[string]any,
	summary string,
) (*neoConfirmation, error) {
	approvalKey := neoApprovalKey(toolName, accessContext.CurrentSite.ID, args)
	if _, ok := accessContext.ApprovedActions[approvalKey]; ok {
		return nil, nil
	}
	if err := s.logNeoAction(ctx, neoActionLog{
		ActionKey:      approvalKey,
		SiteID:         accessContext.CurrentSite.ID,
		ActorUserID:    neoViewerID(accessContext.Viewer),
		ActionType:     toolName,
		ActionLevel:    neoAccessRestricted,
		TargetType:     "site",
		TargetID:       accessContext.CurrentSite.ID,
		Status:         "pending_confirmation",
		Summary:        summary,
		RequestPayload: args,
		ResultPayload:  map[string]any{"confirmationRequired": true},
	}); err != nil {
		return nil, err
	}
	return &neoConfirmation{
		Required:    true,
		ApprovalKey: approvalKey,
		Reason:      "This action is restricted and needs explicit approval before Neo can continue.",
	}, nil
}

func neoViewerID(viewer *neoViewer) string {
	if viewer == nil {
		return ""
	}
	return strings.TrimSpace(viewer.ID)
}

func (s *Server) logNeoAction(ctx context.Context, entry neoActionLog) error {
	entry.ActionKey = strings.TrimSpace(entry.ActionKey)
	if entry.ActionKey == "" {
		entry.ActionKey = neoID("action", entry.ActionType+":"+entry.SiteID+":"+entry.Summary)
	}
	if s.neonPool == nil {
		s.logger.Info("neo action", "action_key", entry.ActionKey, "site_id", entry.SiteID, "action_type", entry.ActionType, "status", entry.Status)
		return nil
	}

	requestPayload, _ := json.Marshal(entry.RequestPayload)
	resultPayload, _ := json.Marshal(entry.ResultPayload)
	_, err := s.neonPool.Exec(ctx, `
		INSERT INTO analytics_neo_action_logs (
			id, site_id, actor_user_id, action_key, action_type, action_level, target_type, target_id,
			status, summary, request_payload, result_payload, updated_at
		) VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, NULLIF($8, ''), $9, $10, $11::jsonb, $12::jsonb, now())
	`, neoID("neal", entry.ActionKey), entry.SiteID, entry.ActorUserID, entry.ActionKey, entry.ActionType, string(entry.ActionLevel), entry.TargetType, entry.TargetID, entry.Status, entry.Summary, string(requestPayload), string(resultPayload))
	if err != nil {
		s.logger.Warn("neo action log failed", "action_key", entry.ActionKey, "error", err)
		return nil
	}
	return nil
}

func (s *Server) neoToolRegistry() map[string]neoToolEntry {
	return map[string]neoToolEntry{
		"get_dashboard_context": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_dashboard_context",
					Description: "Get the current site, accessible sites, selected range, viewer, and product surfaces.",
					Parameters:  map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false},
				},
			},
			Descriptor: neoToolDescriptor{
				Name:             "get_dashboard_context",
				Category:         "data-access",
				Access:           neoAccessReadOnly,
				Description:      "Current navigation, selected site, accessible sites, and viewer context.",
				StructuredOutput: true,
				Logged:           false,
				Parameters:       map[string]any{},
			},
			Execute: s.neoToolGetDashboardContext,
		},
		"get_dashboard_summary": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_dashboard_summary",
					Description: "Get overview metrics, top pages, referrers, device mix, browser mix, and trend points for a site and range.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId": map[string]any{"type": "string"},
							"range":  map[string]any{"type": "string"},
						},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{
				Name:             "get_dashboard_summary",
				Category:         "data-access",
				Access:           neoAccessReadOnly,
				Description:      "Aggregated dashboard metrics with trend context.",
				StructuredOutput: true,
				Logged:           false,
				Parameters: map[string]any{
					"siteId": "optional",
					"range":  "optional",
				},
			},
			Execute: s.neoToolGetDashboardSummary,
		},
		"get_page_analytics": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_page_analytics",
					Description: "Get page-level analytics for a path, including page metrics, event summary, and heatmap totals.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId": map[string]any{"type": "string"},
							"range":  map[string]any{"type": "string"},
							"path":   map[string]any{"type": "string"},
						},
						"required":             []string{"path"},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{
				Name:             "get_page_analytics",
				Category:         "data-access",
				Access:           neoAccessReadOnly,
				Description:      "Per-page metrics plus supporting engagement context.",
				StructuredOutput: true,
				Logged:           false,
				Parameters:       map[string]any{"path": "required"},
			},
			Execute: s.neoToolGetPageAnalytics,
		},
		"get_event_explorer": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_event_explorer",
					Description: "Get event families, top events, privacy-safe properties, and live activity for a site and optional path.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId": map[string]any{"type": "string"},
							"range":  map[string]any{"type": "string"},
							"path":   map[string]any{"type": "string"},
						},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "get_event_explorer", Category: "data-access", Access: neoAccessReadOnly, Description: "Event families, highlights, and privacy-safe property facets.", StructuredOutput: true},
			Execute:    s.neoToolGetEventExplorer,
		},
		"get_heatmap_metrics": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_heatmap_metrics",
					Description: "Get numeric heatmap aggregates, top selectors, hotspots, and confidence for a path.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId":      map[string]any{"type": "string"},
							"range":       map[string]any{"type": "string"},
							"path":        map[string]any{"type": "string"},
							"mode":        map[string]any{"type": "string", "enum": []string{"engagement", "click", "rage", "move", "scroll"}},
							"clickFilter": map[string]any{"type": "string", "enum": []string{"all", "rage", "dead", "error"}},
							"viewport":    map[string]any{"type": "string", "enum": []string{"all", "mobile", "tablet", "desktop"}},
						},
						"required":             []string{"path"},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "get_heatmap_metrics", Category: "data-access", Access: neoAccessReadOnly, Description: "Privacy-safe heatmap metrics and hotspots.", StructuredOutput: true},
			Execute:    s.neoToolGetHeatmapMetrics,
		},
		"get_geo_summary": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_geo_summary",
					Description: "Get geographic summary metrics and top countries, regions, and cities for a site and range.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId": map[string]any{"type": "string"},
							"range":  map[string]any{"type": "string"},
						},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "get_geo_summary", Category: "data-access", Access: neoAccessReadOnly, Description: "Coarse geo summary with privacy-safe coverage signals.", StructuredOutput: true},
			Execute:    s.neoToolGetGeoSummary,
		},
		"get_funnel_report": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_funnel_report",
					Description: "Get a funnel report for a set of steps. Each step needs kind, matchType, value, and optional label.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId":        map[string]any{"type": "string"},
							"range":         map[string]any{"type": "string"},
							"countMode":     map[string]any{"type": "string", "enum": []string{"sessions", "visitors"}},
							"windowMinutes": map[string]any{"type": "number"},
							"steps": map[string]any{
								"type": "array",
								"items": map[string]any{
									"type": "object",
									"properties": map[string]any{
										"label":     map[string]any{"type": "string"},
										"kind":      map[string]any{"type": "string", "enum": []string{"page", "event"}},
										"matchType": map[string]any{"type": "string", "enum": []string{"exact", "prefix"}},
										"value":     map[string]any{"type": "string"},
									},
									"required":             []string{"kind", "matchType", "value"},
									"additionalProperties": false,
								},
							},
						},
						"required":             []string{"steps"},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "get_funnel_report", Category: "data-access", Access: neoAccessReadOnly, Description: "Conversion funnel report with step drop-off and timing.", StructuredOutput: true},
			Execute:    s.neoToolGetFunnelReport,
		},
		"get_retention_report": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_retention_report",
					Description: "Get cohort retention summary and trend data for a site and range.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId":  map[string]any{"type": "string"},
							"range":   map[string]any{"type": "string"},
							"cadence": map[string]any{"type": "string", "enum": []string{"daily", "weekly", "monthly"}},
							"device":  map[string]any{"type": "string"},
							"country": map[string]any{"type": "string"},
							"limit":   map[string]any{"type": "number"},
						},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "get_retention_report", Category: "data-access", Access: neoAccessReadOnly, Description: "Cohort retention summary and confidence.", StructuredOutput: true},
			Execute:    s.neoToolGetRetentionReport,
		},
		"get_session_replay_metadata": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_session_replay_metadata",
					Description: "Get replay session metadata without returning raw replay events.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId":    map[string]any{"type": "string"},
							"range":     map[string]any{"type": "string"},
							"sessionId": map[string]any{"type": "string"},
							"limit":     map[string]any{"type": "number"},
						},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "get_session_replay_metadata", Category: "data-access", Access: neoAccessReadOnly, Description: "Replay session summaries only, never raw replay payloads.", StructuredOutput: true},
			Execute:    s.neoToolGetSessionReplayMetadata,
		},
		"get_user_list": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_user_list",
					Description: "Get the privacy-safe users list with fictional aliases, filters, sorting, and pagination.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId":  map[string]any{"type": "string"},
							"range":   map[string]any{"type": "string"},
							"page":    map[string]any{"type": "number"},
							"limit":   map[string]any{"type": "number"},
							"sort":    map[string]any{"type": "string", "enum": []string{"last_seen", "first_seen", "pageviews", "events", "country", "browser", "os", "alias"}},
							"order":   map[string]any{"type": "string", "enum": []string{"asc", "desc"}},
							"search":  map[string]any{"type": "string"},
							"country": map[string]any{"type": "string"},
							"state":   map[string]any{"type": "string"},
							"browser": map[string]any{"type": "string"},
							"os":      map[string]any{"type": "string"},
						},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "get_user_list", Category: "data-access", Access: neoAccessReadOnly, Description: "Paginated, sortable, filterable user aggregates with fictional aliases.", StructuredOutput: true},
			Execute:    s.neoToolGetUserList,
		},
		"get_user_detail": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_user_detail",
					Description: "Get user detail for a privacy-safe user hash, including top pages, events, and session history.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId":   map[string]any{"type": "string"},
							"range":    map[string]any{"type": "string"},
							"userHash": map[string]any{"type": "string"},
						},
						"required":             []string{"userHash"},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "get_user_detail", Category: "data-access", Access: neoAccessReadOnly, Description: "User detail for a privacy-safe user hash.", StructuredOutput: true},
			Execute:    s.neoToolGetUserDetail,
		},
		"get_saved_segments": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_saved_segments",
					Description: "List saved segments for the current site.",
					Parameters:  map[string]any{"type": "object", "properties": map[string]any{"siteId": map[string]any{"type": "string"}}, "additionalProperties": false},
				},
			},
			Descriptor: neoToolDescriptor{Name: "get_saved_segments", Category: "data-access", Access: neoAccessReadOnly, Description: "Saved segment definitions.", StructuredOutput: true},
			Execute:    s.neoToolGetSavedSegments,
		},
		"preview_segment": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "preview_segment",
					Description: "Preview a segment definition before saving it and return audience size, metrics, and sample members.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId":      map[string]any{"type": "string"},
							"range":       map[string]any{"type": "string"},
							"name":        map[string]any{"type": "string"},
							"description": map[string]any{"type": "string"},
							"logic":       map[string]any{"type": "string", "enum": []string{"and", "or"}},
							"conditions":  map[string]any{"type": "array"},
						},
						"required":             []string{"conditions"},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "preview_segment", Category: "data-access", Access: neoAccessReadOnly, Description: "Segment audience preview and sample members.", StructuredOutput: true},
			Execute:    s.neoToolPreviewSegment,
		},
		"get_cohort_analysis": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_cohort_analysis",
					Description: "Get cohort analysis for time-based or behavior-based cohorts and an optional saved segment.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId":    map[string]any{"type": "string"},
							"range":     map[string]any{"type": "string"},
							"mode":      map[string]any{"type": "string", "enum": []string{"time", "behavior"}},
							"cadence":   map[string]any{"type": "string", "enum": []string{"daily", "weekly", "monthly"}},
							"segmentId": map[string]any{"type": "string"},
							"behavior":  map[string]any{"type": "object"},
						},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "get_cohort_analysis", Category: "data-access", Access: neoAccessReadOnly, Description: "Time or behavior cohort analysis.", StructuredOutput: true},
			Execute:    s.neoToolGetCohortAnalysis,
		},
		"list_alerts": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "list_alerts",
					Description: "List configured alerts, channels, and channel health state for the current site.",
					Parameters:  map[string]any{"type": "object", "properties": map[string]any{"siteId": map[string]any{"type": "string"}}, "additionalProperties": false},
				},
			},
			Descriptor: neoToolDescriptor{Name: "list_alerts", Category: "data-access", Access: neoAccessReadOnly, Description: "Alert definitions and channel health.", StructuredOutput: true},
			Execute:    s.neoToolListAlerts,
		},
		"get_alert_history": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_alert_history",
					Description: "Get alert firing history and per-channel delivery results for a saved alert.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId":  map[string]any{"type": "string"},
							"alertId": map[string]any{"type": "string"},
						},
						"required":             []string{"alertId"},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "get_alert_history", Category: "data-access", Access: neoAccessReadOnly, Description: "Alert firing history and delivery attempts.", StructuredOutput: true},
			Execute:    s.neoToolGetAlertHistory,
		},
		"upsert_alert": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "upsert_alert",
					Description: "Create or update an alert with multi-channel delivery. Use alertId only when updating an existing alert.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId":    map[string]any{"type": "string"},
							"alertId":   map[string]any{"type": "string"},
							"name":      map[string]any{"type": "string"},
							"metric":    map[string]any{"type": "string"},
							"condition": map[string]any{"type": "string"},
							"threshold": map[string]any{"type": "number"},
							"period":    map[string]any{"type": "string"},
							"enabled":   map[string]any{"type": "boolean"},
							"channels":  map[string]any{"type": "array"},
						},
						"required":             []string{"name", "metric", "condition", "threshold", "period", "channels"},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "upsert_alert", Category: "action", Access: neoAccessSafeWrite, Description: "Create or update multi-channel alerts.", StructuredOutput: true, Logged: true},
			Execute:    s.neoToolUpsertAlert,
		},
		"list_integrations": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "list_integrations",
					Description: "List provider connections, health summaries, and developer surfaces for the current site.",
					Parameters:  map[string]any{"type": "object", "properties": map[string]any{"siteId": map[string]any{"type": "string"}}, "additionalProperties": false},
				},
			},
			Descriptor: neoToolDescriptor{Name: "list_integrations", Category: "data-access", Access: neoAccessReadOnly, Description: "Provider connections and health summaries.", StructuredOutput: true},
			Execute:    s.neoToolListIntegrations,
		},
		"connect_integration": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "connect_integration",
					Description: "Create, reconnect, or rotate an integration connection. Use integrationId for reconnect or rotate flows.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId":        map[string]any{"type": "string"},
							"integrationId": map[string]any{"type": "string"},
							"providerKey":   map[string]any{"type": "string"},
							"displayName":   map[string]any{"type": "string"},
							"config":        map[string]any{"type": "object"},
						},
						"required":             []string{"providerKey", "config"},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "connect_integration", Category: "action", Access: neoAccessSafeWrite, Description: "Connect, reconnect, or rotate an integration.", StructuredOutput: true, Logged: true},
			Execute:    s.neoToolConnectIntegration,
		},
		"get_settings_summary": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_settings_summary",
					Description: "Get site settings, privacy, retention, and tracker status without returning raw secrets.",
					Parameters: map[string]any{
						"type":                 "object",
						"properties":           map[string]any{"siteId": map[string]any{"type": "string"}},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "get_settings_summary", Category: "configuration", Access: neoAccessReadOnly, Description: "Site settings, privacy posture, retention, and tracker status.", StructuredOutput: true},
			Execute:    s.neoToolGetSettingsSummary,
		},
		"get_tracker_installation": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_tracker_installation",
					Description: "Get the exact tracker script source and install snippet for a site.",
					Parameters:  map[string]any{"type": "object", "properties": map[string]any{"siteId": map[string]any{"type": "string"}}, "additionalProperties": false},
				},
			},
			Descriptor: neoToolDescriptor{Name: "get_tracker_installation", Category: "configuration", Access: neoAccessReadOnly, Description: "Exact tracker installation snippet and source.", StructuredOutput: true},
			Execute:    s.neoToolGetTrackerInstallation,
		},
		"list_site_pages": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "list_site_pages",
					Description: "List discovered site pages from control-plane storage when available, otherwise fall back to analytics page paths.",
					Parameters:  map[string]any{"type": "object", "properties": map[string]any{"siteId": map[string]any{"type": "string"}}, "additionalProperties": false},
				},
			},
			Descriptor: neoToolDescriptor{Name: "list_site_pages", Category: "configuration", Access: neoAccessReadOnly, Description: "Known site pages and their discovery source.", StructuredOutput: true},
			Execute:    s.neoToolListSitePages,
		},
		"get_tracker_health": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_tracker_health",
					Description: "Check whether the tracker appears healthy based on recent data freshness and current script configuration.",
					Parameters:  map[string]any{"type": "object", "properties": map[string]any{"siteId": map[string]any{"type": "string"}}, "additionalProperties": false},
				},
			},
			Descriptor: neoToolDescriptor{Name: "get_tracker_health", Category: "diagnostic", Access: neoAccessReadOnly, Description: "Heuristic tracker health and freshness checks.", StructuredOutput: true},
			Execute:    s.neoToolGetTrackerHealth,
		},
		"validate_tracker_script": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "validate_tracker_script",
					Description: "Validate that the generated tracker script and snippet match the current site privacy settings and origin rules.",
					Parameters:  map[string]any{"type": "object", "properties": map[string]any{"siteId": map[string]any{"type": "string"}}, "additionalProperties": false},
				},
			},
			Descriptor: neoToolDescriptor{Name: "validate_tracker_script", Category: "diagnostic", Access: neoAccessReadOnly, Description: "Static validation for tracker source and snippet consistency.", StructuredOutput: true},
			Execute:    s.neoToolValidateTrackerScript,
		},
		"get_data_freshness": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_data_freshness",
					Description: "Check when site data was last seen and whether replay metadata exists recently.",
					Parameters:  map[string]any{"type": "object", "properties": map[string]any{"siteId": map[string]any{"type": "string"}, "range": map[string]any{"type": "string"}}, "additionalProperties": false},
				},
			},
			Descriptor: neoToolDescriptor{Name: "get_data_freshness", Category: "diagnostic", Access: neoAccessReadOnly, Description: "Last-seen freshness across events and replay metadata.", StructuredOutput: true},
			Execute:    s.neoToolGetDataFreshness,
		},
		"get_integration_status": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "get_integration_status",
					Description: "Get the current status of storage, control-plane, tracker, snapshot, and AI provider integrations.",
					Parameters:  map[string]any{"type": "object", "properties": map[string]any{"siteId": map[string]any{"type": "string"}}, "additionalProperties": false},
				},
			},
			Descriptor: neoToolDescriptor{Name: "get_integration_status", Category: "diagnostic", Access: neoAccessReadOnly, Description: "Current backend integration readiness.", StructuredOutput: true},
			Execute:    s.neoToolGetIntegrationStatus,
		},
		"update_profile_name": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "update_profile_name",
					Description: "Update the current viewer full name. Use only when the user explicitly asks to rename their profile.",
					Parameters: map[string]any{
						"type":                 "object",
						"properties":           map[string]any{"fullName": map[string]any{"type": "string"}},
						"required":             []string{"fullName"},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "update_profile_name", Category: "action", Access: neoAccessSafeWrite, Description: "Rename the current viewer profile.", StructuredOutput: true, Logged: true},
			Execute:    s.neoToolUpdateProfileName,
		},
		"regenerate_tracker_script": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "regenerate_tracker_script",
					Description: "Regenerate the current site's tracker script and snippet using the latest privacy settings.",
					Parameters:  map[string]any{"type": "object", "properties": map[string]any{"siteId": map[string]any{"type": "string"}}, "additionalProperties": false},
				},
			},
			Descriptor: neoToolDescriptor{Name: "regenerate_tracker_script", Category: "action", Access: neoAccessSafeWrite, Description: "Generate and persist a fresh tracker script when control-plane storage is available.", StructuredOutput: true, Logged: true},
			Execute:    s.neoToolRegenerateTrackerScript,
		},
		"update_privacy_settings": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "update_privacy_settings",
					Description: "Update the site's privacy settings. Supported fields are domSnapshotsEnabled and visitorCookieEnabled.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId":               map[string]any{"type": "string"},
							"domSnapshotsEnabled":  map[string]any{"type": "boolean"},
							"visitorCookieEnabled": map[string]any{"type": "boolean"},
						},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "update_privacy_settings", Category: "action", Access: neoAccessSafeWrite, Description: "Update privacy-sensitive tracker settings.", StructuredOutput: true, Logged: true},
			Execute:    s.neoToolUpdatePrivacySettings,
		},
		"create_billing_adjustment_request": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "create_billing_adjustment_request",
					Description: "Queue a restricted billing remediation request such as a refund, credit, coupon, or upgrade remediation.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId":   map[string]any{"type": "string"},
							"kind":     map[string]any{"type": "string", "enum": []string{"refund", "credit", "coupon", "upgrade_remediation"}},
							"reason":   map[string]any{"type": "string"},
							"amount":   map[string]any{"type": "string"},
							"currency": map[string]any{"type": "string"},
							"notes":    map[string]any{"type": "string"},
						},
						"required":             []string{"kind", "reason"},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "create_billing_adjustment_request", Category: "action", Access: neoAccessRestricted, Description: "Queue a restricted billing remediation request after approval.", StructuredOutput: true, RequiresConfirmation: true, Logged: true},
			Execute:    s.neoToolCreateBillingAdjustmentRequest,
		},
		"create_customer_service_handoff": {
			Schema: neoToolSchema{
				Type: "function",
				Function: neoToolFunctionSchema{
					Name:        "create_customer_service_handoff",
					Description: "Queue a restricted customer-service handoff with support context and the user's request summary.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"siteId":          map[string]any{"type": "string"},
							"reason":          map[string]any{"type": "string"},
							"customerMessage": map[string]any{"type": "string"},
							"priority":        map[string]any{"type": "string"},
						},
						"required":             []string{"reason"},
						"additionalProperties": false,
					},
				},
			},
			Descriptor: neoToolDescriptor{Name: "create_customer_service_handoff", Category: "action", Access: neoAccessRestricted, Description: "Queue a restricted support handoff after approval.", StructuredOutput: true, RequiresConfirmation: true, Logged: true},
			Execute:    s.neoToolCreateCustomerServiceHandoff,
		},
	}
}

func (s *Server) neoToolGetDashboardContext(_ context.Context, access *neoAccessContext, _ map[string]any) (neoToolResult, error) {
	accessibleSites := make([]map[string]any, 0, len(access.Sites))
	for _, site := range access.Sites {
		accessibleSites = append(accessibleSites, map[string]any{
			"id":      site.ID,
			"name":    site.Name,
			"label":   neoLabelForSite(site),
			"origins": slices.Clone(site.Origins),
		})
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Resolved dashboard context for %s across %d accessible sites.", neoLabelForSite(access.CurrentSite), len(access.Sites)),
		Highlights: []string{"Current page: " + access.Pathname, "Selected range: " + access.SelectedRange.String()},
		Privacy:    "Viewer context is optional and analytics data remains aggregated.",
		Scope:      map[string]any{"siteId": access.CurrentSite.ID, "range": access.SelectedRange.String()},
		Data: map[string]any{
			"mode":            access.Mode,
			"path":            access.Pathname,
			"selectedRange":   access.SelectedRange.String(),
			"currentSite":     map[string]any{"id": access.CurrentSite.ID, "name": access.CurrentSite.Name, "label": neoLabelForSite(access.CurrentSite), "origins": slices.Clone(access.CurrentSite.Origins)},
			"accessibleSites": accessibleSites,
			"viewer":          access.Viewer,
			"surfaces":        slices.Clone(access.Surfaces),
		},
	}, nil
}

func (s *Server) neoToolGetDashboardSummary(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	rangeValue := storage.ParseTimeRange(firstNonEmpty(neoStringArg(args, "range"), access.SelectedRange.String()))
	summary, err := s.dashboard.DashboardSummary(ctx, site.ID, rangeValue, time.Now().UTC())
	if err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded dashboard summary for %s over %s with %d sessions and %d pageviews.", neoLabelForSite(site), rangeValue.String(), summary.Overview.Sessions, summary.Overview.Pageviews),
		Highlights: []string{fmt.Sprintf("Top page: %s", neoTopPageLabel(summary.TopPages)), fmt.Sprintf("Top referrer: %s", neoTopReferrerLabel(summary.Referrers))},
		Confidence: "high",
		Privacy:    "Aggregated site metrics only. No visitor identifiers are exposed.",
		Scope:      map[string]any{"siteId": site.ID, "range": rangeValue.String()},
		Data: map[string]any{
			"site":             map[string]any{"id": site.ID, "label": neoLabelForSite(site)},
			"range":            rangeValue.String(),
			"overview":         summary.Overview,
			"comparison":       summary.OverviewComparison,
			"derived":          summary.Derived,
			"timeseries":       neoTailSlice(summary.Timeseries, 14),
			"topPages":         neoHeadSlice(summary.TopPages, 8),
			"referrers":        neoHeadSlice(summary.Referrers, 6),
			"devices":          neoHeadSlice(summary.Devices, 4),
			"browsers":         neoHeadSlice(summary.Browsers, 4),
			"operatingSystems": neoHeadSlice(summary.OperatingSystems, 4),
			"scrollFunnel":     summary.ScrollFunnel,
			"pages":            neoHeadSlice(summary.Pages, 20),
		},
	}, nil
}

func (s *Server) neoToolGetPageAnalytics(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	path := firstNonEmpty(neoStringArg(args, "path"), "/")
	rangeValue := storage.ParseTimeRange(firstNonEmpty(neoStringArg(args, "range"), access.SelectedRange.String()))
	now := time.Now().UTC()

	summary, err := s.dashboard.DashboardSummary(ctx, site.ID, rangeValue, now)
	if err != nil {
		return neoToolResult{}, err
	}
	eventView, eventErr := s.dashboard.EventExplorer(ctx, site.ID, storage.EventExplorerQuery{Path: path}, rangeValue, now)
	heatmap, heatmapErr := s.dashboard.Heatmap(ctx, site.ID, path, rangeValue, storage.HeatmapModeEngagement, storage.HeatmapClickFilterAll, storage.HeatmapViewportSegmentAll, now)

	pageMetric := neoFindPageMetric(summary.TopPages, path)
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded page analytics for %s on %s over %s.", path, neoLabelForSite(site), rangeValue.String()),
		Highlights: []string{fmt.Sprintf("Pageviews: %d", pageMetric.Pageviews), fmt.Sprintf("Sessions: %d", pageMetric.Sessions)},
		Freshness:  "Current range aggregate",
		Confidence: "high",
		Privacy:    "Page-level analytics remain aggregated and privacy-safe.",
		Scope:      map[string]any{"siteId": site.ID, "range": rangeValue.String(), "path": path},
		Data: map[string]any{
			"page":           pageMetric,
			"eventSummary":   neoEventExplorerData(eventView, eventErr),
			"heatmapSummary": neoHeatmapSummaryData(heatmap, heatmapErr),
		},
	}, nil
}

func (s *Server) neoToolGetEventExplorer(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	rangeValue := storage.ParseTimeRange(firstNonEmpty(neoStringArg(args, "range"), access.SelectedRange.String()))
	path := neoStringArg(args, "path")
	view, err := s.dashboard.EventExplorer(ctx, site.ID, storage.EventExplorerQuery{Path: path}, rangeValue, time.Now().UTC())
	if err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded event explorer data for %s over %s.", neoLabelForSite(site), rangeValue.String()),
		Highlights: []string{fmt.Sprintf("Accepted events: %d", view.Summary.AcceptedEvents), fmt.Sprintf("Active sessions: %d", view.Live.ActiveSessions)},
		Freshness:  view.Summary.FreshnessLabel,
		Confidence: fmt.Sprintf("%.0f/100", view.Summary.ConfidenceScore),
		Privacy:    "Properties stay privacy-safe and low-volume rows remain behind the privacy floor.",
		Scope:      map[string]any{"siteId": site.ID, "range": rangeValue.String(), "path": path},
		Data: map[string]any{
			"summary":    view.Summary,
			"families":   neoHeadSlice(view.Families, 6),
			"catalog":    neoHeadSlice(view.Catalog, 6),
			"highlights": neoHeadSlice(view.Trends.Highlights, 6),
			"live": map[string]any{
				"generatedAt":     view.Live.GeneratedAt,
				"activeEvents":    view.Live.ActiveEvents,
				"activeSessions":  view.Live.ActiveSessions,
				"activeVisitors":  view.Live.ActiveVisitors,
				"activePages":     neoHeadSlice(view.Live.ActivePages, 6),
				"activeCountries": neoHeadSlice(view.Live.ActiveCountries, 6),
				"freshness":       view.Live.Freshness,
				"trust":           view.Live.Trust,
			},
		},
	}, nil
}

func (s *Server) neoToolGetHeatmapMetrics(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	rangeValue := storage.ParseTimeRange(firstNonEmpty(neoStringArg(args, "range"), access.SelectedRange.String()))
	path := firstNonEmpty(neoStringArg(args, "path"), "/")
	mode := storage.ParseHeatmapMode(neoStringArg(args, "mode"))
	clickFilter := storage.ParseHeatmapClickFilter(neoStringArg(args, "clickFilter"))
	viewport := storage.ParseHeatmapViewportSegment(neoStringArg(args, "viewport"))

	view, err := s.dashboard.Heatmap(ctx, site.ID, path, rangeValue, mode, clickFilter, viewport, time.Now().UTC())
	if err != nil {
		return neoToolResult{}, err
	}
	hotspots := slices.Clone(view.Buckets)
	slices.SortFunc(hotspots, func(a, b storage.HeatmapBucket) int {
		return b.Count - a.Count
	})
	if len(hotspots) > 12 {
		hotspots = hotspots[:12]
	}

	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded %s heatmap metrics for %s on %s.", view.Mode, view.Path, neoLabelForSite(site)),
		Highlights: []string{fmt.Sprintf("Clicks: %d", view.Totals.Clicks), fmt.Sprintf("Unique sessions: %d", view.Totals.UniqueSessions)},
		Freshness:  view.Confidence.Freshness,
		Confidence: fmt.Sprintf("%.0f/100", view.Confidence.Score),
		Privacy:    "Heatmap data stays aggregated and blocked zones are reported separately.",
		Scope:      map[string]any{"siteId": site.ID, "range": rangeValue.String(), "path": path, "mode": view.Mode},
		Data: map[string]any{
			"totals":       view.Totals,
			"confidence":   view.Confidence,
			"scrollFunnel": view.ScrollFunnel,
			"topSelectors": neoHeadSlice(view.Selectors, 8),
			"hotspots":     hotspots,
			"viewport":     view.Viewport,
			"document":     view.Document,
		},
	}, nil
}

func (s *Server) neoToolGetGeoSummary(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	rangeValue := storage.ParseTimeRange(firstNonEmpty(neoStringArg(args, "range"), access.SelectedRange.String()))
	view, err := s.dashboard.Map(ctx, site.ID, rangeValue, time.Now().UTC())
	if err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded geo summary for %s over %s.", neoLabelForSite(site), rangeValue.String()),
		Highlights: []string{fmt.Sprintf("Top country: %s", view.Summary.TopCountryName), fmt.Sprintf("Coverage confidence: %.0f%%", view.Summary.CoverageConfidence)},
		Freshness:  view.Signals.Realtime.Freshness,
		Confidence: fmt.Sprintf("%.0f/100", view.Signals.Confidence.CoverageConfidence),
		Privacy:    "Geo results stay coarse only and withheld rows remain privacy-safe.",
		Scope:      map[string]any{"siteId": site.ID, "range": rangeValue.String()},
		Data: map[string]any{
			"summary":   view.Summary,
			"signals":   view.Signals,
			"countries": neoHeadSlice(view.Countries, 8),
			"regions":   neoHeadSlice(view.Regions, 8),
			"cities":    neoHeadSlice(view.Cities, 8),
		},
	}, nil
}

func (s *Server) neoToolGetFunnelReport(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	rangeValue := storage.ParseTimeRange(firstNonEmpty(neoStringArg(args, "range"), access.SelectedRange.String()))
	steps, err := neoFunnelStepsArg(args, "steps")
	if err != nil {
		return neoToolResult{}, err
	}
	query := storage.FunnelQuery{
		CountMode:     firstNonEmpty(neoStringArg(args, "countMode"), string(storage.FunnelCountModeVisitors)),
		WindowMinutes: neoIntArg(args, "windowMinutes", 60),
		Steps:         steps,
	}
	view, err := s.dashboard.FunnelReport(ctx, site.ID, query, rangeValue, time.Now().UTC())
	if err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded funnel report for %s with %d entrants and %d completions.", neoLabelForSite(site), view.Entrants, view.Completions),
		Highlights: []string{fmt.Sprintf("Overall conversion: %.2f%%", view.OverallConversionRate), fmt.Sprintf("Completion median: %ds", view.CompletionTime.MedianSeconds)},
		Confidence: "high",
		Privacy:    "Funnel results are aggregated across sessions or visitors only.",
		Scope:      map[string]any{"siteId": site.ID, "range": rangeValue.String(), "steps": len(query.Steps)},
		Data: map[string]any{
			"countMode":             view.CountMode,
			"windowMinutes":         view.WindowMinutes,
			"entrants":              view.Entrants,
			"completions":           view.Completions,
			"overallConversionRate": view.OverallConversionRate,
			"steps":                 view.Steps,
			"inspection":            view.Inspection,
			"stepTimings":           view.StepTimings,
			"completionTime":        view.CompletionTime,
		},
	}, nil
}

func (s *Server) neoToolGetRetentionReport(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	rangeValue := storage.ParseTimeRange(firstNonEmpty(neoStringArg(args, "range"), access.SelectedRange.String()))
	query := storage.RetentionQuery{
		Cadence:       firstNonEmpty(neoStringArg(args, "cadence"), string(storage.RetentionCadenceWeekly)),
		DeviceFilter:  neoStringArg(args, "device"),
		CountryFilter: neoStringArg(args, "country"),
		Limit:         neoIntArg(args, "limit", 8),
	}
	report, err := s.dashboard.RetentionReport(ctx, site.ID, query, rangeValue, time.Now().UTC())
	if err != nil {
		return neoToolResult{}, err
	}
	trend, trendErr := s.dashboard.RetentionTrend(ctx, site.ID, query, rangeValue, time.Now().UTC())
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded retention report for %s with %d cohorts and %d users.", neoLabelForSite(site), report.Summary.Cohorts, report.Summary.Users),
		Highlights: []string{fmt.Sprintf("Day 1 retention: %.2f%%", report.Summary.Day1Rate), fmt.Sprintf("Day 7 retention: %.2f%%", report.Summary.Day7Rate)},
		Confidence: fmt.Sprintf("%.0f/100 (%s)", report.Summary.Confidence, report.Summary.ConfidenceText),
		Privacy:    "Cohorts stay aggregated and confidence is called out when modeled.",
		Scope:      map[string]any{"siteId": site.ID, "range": rangeValue.String(), "cadence": query.Cadence},
		Data: map[string]any{
			"summary": report.Summary,
			"periods": report.Periods,
			"cohorts": neoHeadSlice(report.Cohorts, max(1, query.Limit)),
			"trend":   neoRetentionTrendData(trend, trendErr),
		},
	}, nil
}

func (s *Server) neoToolGetSessionReplayMetadata(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	sessionID := neoStringArg(args, "sessionId")
	if sessionID != "" {
		detail, err := s.replay.ReplaySession(ctx, site.ID, sessionID)
		if err != nil {
			return neoToolResult{}, err
		}
		return neoToolResult{
			OK:         true,
			Summary:    fmt.Sprintf("Loaded replay metadata for session %s.", sessionID),
			Highlights: []string{fmt.Sprintf("Duration: %dms", detail.Session.DurationMS), fmt.Sprintf("Errors: %d", detail.Session.ErrorCount)},
			Privacy:    "Replay metadata excludes raw replay events and DOM payloads.",
			Scope:      map[string]any{"siteId": site.ID, "sessionId": sessionID},
			Data:       detail.Session,
		}, nil
	}

	rangeValue := storage.ParseTimeRange(firstNonEmpty(neoStringArg(args, "range"), access.SelectedRange.String()))
	limit := neoIntArg(args, "limit", 8)
	if limit < 1 {
		limit = 8
	}
	list, err := s.replay.ReplaySessions(ctx, site.ID, rangeValue, time.Now().UTC())
	if err != nil {
		return neoToolResult{}, err
	}
	sessions := neoHeadSlice(list.Sessions, limit)
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded %d replay session summaries for %s.", len(sessions), neoLabelForSite(site)),
		Highlights: []string{fmt.Sprintf("Range: %s", list.Range)},
		Privacy:    "Replay results include only session metadata, never raw replay payloads.",
		Scope:      map[string]any{"siteId": site.ID, "range": rangeValue.String()},
		Data:       sessions,
	}, nil
}

func (s *Server) neoToolGetUserList(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	if s.users == nil {
		return neoToolResult{}, errors.New("user aggregates are not configured")
	}
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	rangeValue := storage.ParseTimeRange(firstNonEmpty(neoStringArg(args, "range"), access.SelectedRange.String()))
	query := storage.UserListQuery{
		Page:    neoIntArg(args, "page", 1),
		Limit:   neoIntArg(args, "limit", 25),
		Sort:    neoStringArg(args, "sort"),
		Order:   neoStringArg(args, "order"),
		Search:  firstNonEmpty(neoStringArg(args, "search"), neoStringArg(args, "q")),
		Country: neoStringArg(args, "country"),
		Region:  firstNonEmpty(neoStringArg(args, "state"), neoStringArg(args, "region")),
		Browser: neoStringArg(args, "browser"),
		OS:      neoStringArg(args, "os"),
	}
	view, err := s.users.UserList(ctx, site.ID, query, rangeValue, time.Now().UTC())
	if err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded %d of %d privacy-safe user rows for %s.", len(view.Users), view.Total, neoLabelForSite(site)),
		Highlights: []string{"Fictional aliases only.", "No personal identifiers are returned."},
		Freshness:  "Range-scoped user aggregates",
		Confidence: "high",
		Privacy:    view.Privacy.IdentifierPolicy,
		Scope:      map[string]any{"siteId": site.ID, "range": rangeValue.String(), "page": view.Page, "limit": view.Limit},
		Data:       view,
	}, nil
}

func (s *Server) neoToolGetUserDetail(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	if s.users == nil {
		return neoToolResult{}, errors.New("user aggregates are not configured")
	}
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	userHash := neoStringArg(args, "userHash")
	if userHash == "" {
		return neoToolResult{}, errors.New("userHash is required")
	}
	rangeValue := storage.ParseTimeRange(firstNonEmpty(neoStringArg(args, "range"), access.SelectedRange.String()))
	view, err := s.users.UserDetail(ctx, site.ID, userHash, rangeValue, time.Now().UTC())
	if err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded user detail for %s on %s.", view.User.Alias, neoLabelForSite(site)),
		Highlights: []string{fmt.Sprintf("Pageviews: %d", view.User.Pageviews), fmt.Sprintf("Events: %d", view.User.Events)},
		Freshness:  "Range-scoped user detail",
		Confidence: "high",
		Privacy:    view.Privacy.IdentifierPolicy,
		Scope:      map[string]any{"siteId": site.ID, "range": rangeValue.String(), "userHash": userHash},
		Data:       view,
	}, nil
}

func (s *Server) neoToolGetSavedSegments(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	if s.neonPool == nil {
		return neoToolResult{}, errors.New("saved segments require control-plane storage")
	}
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	segments, err := s.listSegments(ctx, site.ID)
	if err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded %d saved segments for %s.", len(segments), neoLabelForSite(site)),
		Highlights: []string{"Segments are reusable across cohorts and filtered user views."},
		Confidence: "high",
		Privacy:    "Segment definitions operate on pseudonymous behavior only.",
		Scope:      map[string]any{"siteId": site.ID},
		Data:       map[string]any{"segments": segments},
	}, nil
}

func (s *Server) neoToolPreviewSegment(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	provider := s.segmentProvider()
	if provider == nil {
		return neoToolResult{}, errors.New("segment analytics are not configured")
	}
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	definition := storage.NormalizeSegmentDefinition(storage.SegmentDefinition{
		SiteID:      site.ID,
		Name:        neoStringArg(args, "name"),
		Description: neoStringArg(args, "description"),
		Logic:       neoStringArg(args, "logic"),
		Conditions:  neoSegmentConditionsArg(args, "conditions"),
	})
	if err := validateSegmentDefinition(definition); err != nil {
		return neoToolResult{}, err
	}
	rangeValue := storage.ParseTimeRange(firstNonEmpty(neoStringArg(args, "range"), access.SelectedRange.String()))
	view, err := provider.PreviewSegment(ctx, site.ID, definition, storage.UserListQuery{Limit: 10}, rangeValue, time.Now().UTC())
	if err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Segment preview audience size is %d for %s.", view.AudienceSize, neoLabelForSite(site)),
		Highlights: []string{fmt.Sprintf("Average pageviews: %.2f", view.AvgPageviews), fmt.Sprintf("Average sessions: %.2f", view.AvgSessions)},
		Confidence: "high",
		Privacy:    view.Privacy.IdentifierPolicy,
		Scope:      map[string]any{"siteId": site.ID, "range": rangeValue.String()},
		Data:       view,
	}, nil
}

func (s *Server) neoToolGetCohortAnalysis(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	provider := s.segmentProvider()
	if provider == nil {
		return neoToolResult{}, errors.New("cohort analytics are not configured")
	}
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	query := storage.CohortAnalysisQuery{
		Mode:    firstNonEmpty(neoStringArg(args, "mode"), string(storage.CohortModeTime)),
		Cadence: firstNonEmpty(neoStringArg(args, "cadence"), string(storage.RetentionCadenceWeekly)),
	}
	if segmentID := neoStringArg(args, "segmentId"); segmentID != "" && s.neonPool != nil {
		definition, err := s.getSegment(ctx, site.ID, segmentID)
		if err == nil {
			query.Segment = &definition
		}
	}
	if behaviorRaw, ok := args["behavior"].(map[string]any); ok {
		condition := neoSegmentConditionFromMap(behaviorRaw)
		query.Behavior = &condition
	}
	rangeValue := storage.ParseTimeRange(firstNonEmpty(neoStringArg(args, "range"), access.SelectedRange.String()))
	view, err := provider.CohortAnalysis(ctx, site.ID, query, rangeValue, time.Now().UTC())
	if err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded %s cohort analysis for %s.", view.Mode, neoLabelForSite(site)),
		Highlights: []string{fmt.Sprintf("Cohorts: %d", view.Summary.Cohorts), fmt.Sprintf("Users: %d", view.Summary.Users)},
		Confidence: fmt.Sprintf("%.0f/100 (%s)", view.Summary.Confidence, view.Summary.ConfidenceText),
		Privacy:    view.Privacy.IdentifierPolicy,
		Scope:      map[string]any{"siteId": site.ID, "range": rangeValue.String(), "mode": view.Mode},
		Data:       view,
	}, nil
}

func (s *Server) neoToolListAlerts(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	if s.neonPool == nil {
		return neoToolResult{}, errors.New("alerts require control-plane storage")
	}
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	view, err := s.listAlerts(ctx, site.ID)
	if err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded %d alerts for %s.", len(view), neoLabelForSite(site)),
		Highlights: []string{"Alert channels include multi-channel health state."},
		Confidence: "high",
		Privacy:    "Alert history and delivery state do not expose personal data.",
		Scope:      map[string]any{"siteId": site.ID},
		Data:       map[string]any{"alerts": view},
	}, nil
}

func (s *Server) neoToolGetAlertHistory(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	if s.neonPool == nil {
		return neoToolResult{}, errors.New("alerts require control-plane storage")
	}
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	alertID := neoStringArg(args, "alertId")
	if alertID == "" {
		return neoToolResult{}, errors.New("alertId is required")
	}
	view, err := s.listAlertHistory(ctx, site.ID, alertID)
	if err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded %d alert firings for alert %s.", len(view), alertID),
		Highlights: []string{"Per-channel delivery outcomes included."},
		Confidence: "high",
		Privacy:    "Alert history is operational telemetry only.",
		Scope:      map[string]any{"siteId": site.ID, "alertId": alertID},
		Data:       map[string]any{"history": view},
	}, nil
}

func (s *Server) neoToolUpsertAlert(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	if s.neonPool == nil {
		return neoToolResult{}, errors.New("alerts require control-plane storage")
	}
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	payload := alertPayload{
		Name:      neoStringArg(args, "name"),
		Metric:    neoStringArg(args, "metric"),
		Condition: neoStringArg(args, "condition"),
		Threshold: float64(neoIntArg(args, "threshold", 0)),
		Period:    neoStringArg(args, "period"),
		Enabled:   neoBoolArg(args, "enabled", true),
		Channels:  neoAlertChannelsArg(args, "channels"),
	}
	alert, err := normalizeAlertPayload(site.ID, payload)
	if err != nil {
		return neoToolResult{}, err
	}
	alertID := neoStringArg(args, "alertId")
	var result any
	if alertID == "" {
		created, createErr := s.createAlert(ctx, alert)
		if createErr != nil {
			return neoToolResult{}, createErr
		}
		result = created
	} else {
		alert.ID = alertID
		updated, updateErr := s.updateAlert(ctx, alert)
		if updateErr != nil {
			return neoToolResult{}, updateErr
		}
		result = updated
	}
	if err := s.logNeoAction(ctx, neoActionLog{
		ActionKey:      neoApprovalKey("upsert_alert", site.ID, args),
		SiteID:         site.ID,
		ActorUserID:    neoViewerID(access.Viewer),
		ActionType:     "upsert_alert",
		ActionLevel:    neoAccessSafeWrite,
		TargetType:     "site",
		TargetID:       site.ID,
		Status:         "completed",
		Summary:        "Created or updated an alert definition.",
		RequestPayload: args,
		ResultPayload:  map[string]any{"siteId": site.ID},
	}); err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    "Saved the alert definition.",
		Highlights: []string{"Safe-write action logged."},
		Confidence: "high",
		Privacy:    "Alert config stores operational channel data only.",
		Scope:      map[string]any{"siteId": site.ID},
		Data:       result,
	}, nil
}

func (s *Server) neoToolListIntegrations(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	if s.neonPool == nil {
		return neoToolResult{}, errors.New("integrations require control-plane storage")
	}
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	view, err := s.listIntegrations(ctx, site.ID)
	if err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded %d integration surfaces for %s.", len(view), neoLabelForSite(site)),
		Highlights: []string{"Configured is separated from actively healthy."},
		Confidence: "high",
		Privacy:    "Integration secrets are stored as hashes and never returned.",
		Scope:      map[string]any{"siteId": site.ID},
		Data:       map[string]any{"integrations": view},
	}, nil
}

func (s *Server) neoToolConnectIntegration(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	if s.neonPool == nil {
		return neoToolResult{}, errors.New("integrations require control-plane storage")
	}
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	configValue, _ := args["config"].(map[string]any)
	record, details, err := normalizeIntegrationPayload(integrationPayload{
		ProviderKey: neoStringArg(args, "providerKey"),
		DisplayName: neoStringArg(args, "displayName"),
		Config:      configValue,
	})
	if err != nil {
		return neoToolResult{OK: false, Summary: "Integration validation failed.", Data: map[string]any{"details": details}, Error: "validation_failed"}, nil
	}
	record.ID = neoStringArg(args, "integrationId")
	record.SiteID = site.ID
	result, err := s.upsertIntegration(ctx, record)
	if err != nil {
		return neoToolResult{}, err
	}
	if err := s.logNeoAction(ctx, neoActionLog{
		ActionKey:      neoApprovalKey("connect_integration", site.ID, args),
		SiteID:         site.ID,
		ActorUserID:    neoViewerID(access.Viewer),
		ActionType:     "connect_integration",
		ActionLevel:    neoAccessSafeWrite,
		TargetType:     "site",
		TargetID:       site.ID,
		Status:         "completed",
		Summary:        "Created or updated an integration connection.",
		RequestPayload: args,
		ResultPayload:  map[string]any{"providerKey": record.ProviderKey},
	}); err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    "Saved the integration connection.",
		Highlights: []string{"Safe-write action logged."},
		Confidence: "high",
		Privacy:    "Tokens are hashed before storage and never returned.",
		Scope:      map[string]any{"siteId": site.ID, "providerKey": record.ProviderKey},
		Data:       result,
	}, nil
}

func (s *Server) neoToolGetSettingsSummary(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	stats, err := s.dashboard.SiteStats(ctx, site.ID)
	if err != nil {
		return neoToolResult{}, err
	}
	script, scriptErr := s.neoTrackerScript(ctx, access.RequestOrigin, site)
	if scriptErr != nil {
		return neoToolResult{}, scriptErr
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded settings summary for %s.", neoLabelForSite(site)),
		Highlights: []string{fmt.Sprintf("Tracked pages: %d", stats.TrackedPages), fmt.Sprintf("Tracker persisted: %t", script.IsPersisted)},
		Freshness:  neoSiteStatsFreshness(stats),
		Confidence: "high",
		Privacy:    "Only privacy-safe tracker settings are exposed.",
		Scope:      map[string]any{"siteId": site.ID},
		Data: map[string]any{
			"site": map[string]any{"id": site.ID, "name": site.Name, "origins": slices.Clone(site.Origins)},
			"privacy": map[string]any{
				"domSnapshotsEnabled":  site.DomSnapshotsEnabled,
				"visitorCookieEnabled": site.VisitorCookieEnabled,
			},
			"retention": map[string]any{
				"eventsDays":   s.cfg.EventRetentionDays,
				"heatmapDays":  s.cfg.HeatmapRetentionDays,
				"replayDays":   s.cfg.ReplayRetentionDays,
				"insightsDays": s.cfg.InsightRetentionDays,
			},
			"stats":         stats,
			"trackerScript": script,
		},
	}, nil
}

func (s *Server) neoToolGetTrackerInstallation(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	script, err := s.neoTrackerScript(ctx, access.RequestOrigin, site)
	if err != nil {
		return neoToolResult{}, err
	}
	snippet := s.trackerSnippet(neoHTTPRequest(access.RequestOrigin), site)
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded the exact tracker installation snippet for %s.", neoLabelForSite(site)),
		Highlights: []string{fmt.Sprintf("Collector origin: %s", script.CollectorOrigin), fmt.Sprintf("Install origin: %s", script.InstallOrigin)},
		Privacy:    "The snippet contains only site-scoped tracking configuration.",
		Scope:      map[string]any{"siteId": site.ID},
		Data: map[string]any{
			"trackerScript":  script,
			"trackerSnippet": snippet,
		},
	}, nil
}

func (s *Server) neoToolListSitePages(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	pages, source, err := s.neoListSitePages(ctx, site.ID, access.SelectedRange)
	if err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded %d known site pages for %s.", len(pages), neoLabelForSite(site)),
		Highlights: []string{fmt.Sprintf("Source: %s", source)},
		Privacy:    "Page discovery stores paths only and never personal user data.",
		Scope:      map[string]any{"siteId": site.ID},
		Data: map[string]any{
			"source":    source,
			"pageCount": len(pages),
			"pages":     neoHeadSlice(pages, 80),
		},
	}, nil
}

func (s *Server) neoToolGetTrackerHealth(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	stats, err := s.dashboard.SiteStats(ctx, site.ID)
	if err != nil {
		return neoToolResult{}, err
	}
	script, scriptErr := s.neoTrackerScript(ctx, access.RequestOrigin, site)
	if scriptErr != nil {
		return neoToolResult{}, scriptErr
	}

	status := "healthy"
	reasons := []string{}
	if stats.LastSeen == nil {
		status = "missing"
		reasons = append(reasons, "No analytics events have been received yet.")
	} else if time.Since(stats.LastSeen.UTC()) > 30*time.Minute {
		status = "stale"
		reasons = append(reasons, fmt.Sprintf("Last event arrived at %s UTC.", stats.LastSeen.UTC().Format(time.RFC3339)))
	}
	if strings.TrimSpace(script.ScriptSrc) == "" || !strings.Contains(script.ScriptTag, site.ID) {
		status = "broken"
		reasons = append(reasons, "Tracker script metadata is incomplete.")
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "Recent site activity and tracker metadata look consistent.")
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Tracker health for %s is %s.", neoLabelForSite(site), status),
		Highlights: reasons,
		Freshness:  neoSiteStatsFreshness(stats),
		Confidence: "medium",
		Privacy:    "Health checks use aggregate freshness and configuration state only.",
		Scope:      map[string]any{"siteId": site.ID},
		Data: map[string]any{
			"status":       status,
			"lastSeen":     stats.LastSeen,
			"totalEvents":  stats.TotalEvents,
			"trackedPages": stats.TrackedPages,
			"trackerScript": map[string]any{
				"scriptSrc":   script.ScriptSrc,
				"isPersisted": script.IsPersisted,
				"updatedAt":   script.UpdatedAt,
			},
		},
	}, nil
}

func (s *Server) neoToolValidateTrackerScript(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	script, err := s.neoTrackerScript(ctx, access.RequestOrigin, site)
	if err != nil {
		return neoToolResult{}, err
	}

	issues := []string{}
	if !strings.Contains(script.ScriptSrc, "t.js?id="+site.ID) {
		issues = append(issues, "Script source is not pinned to the current site id.")
	}
	if !strings.Contains(script.ScriptTag, site.ID) {
		issues = append(issues, "Install snippet is missing the site id attribute.")
	}
	if site.DomSnapshotsEnabled && !strings.Contains(script.ScriptSrc, "snapshot_origin=") {
		issues = append(issues, "DOM snapshots are enabled but the snapshot origin query parameter is missing.")
	}

	status := "valid"
	if len(issues) > 0 {
		status = "invalid"
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Tracker script validation for %s is %s.", neoLabelForSite(site), status),
		Highlights: neoDefaultIssues(issues, "Script source and snippet match the current site settings."),
		Confidence: "high",
		Privacy:    "Validation checks only the generated snippet and script metadata.",
		Scope:      map[string]any{"siteId": site.ID},
		Data: map[string]any{
			"status":    status,
			"issues":    issues,
			"scriptSrc": script.ScriptSrc,
			"scriptTag": script.ScriptTag,
		},
	}, nil
}

func (s *Server) neoToolGetDataFreshness(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	rangeValue := storage.ParseTimeRange(firstNonEmpty(neoStringArg(args, "range"), access.SelectedRange.String()))
	stats, err := s.dashboard.SiteStats(ctx, site.ID)
	if err != nil {
		return neoToolResult{}, err
	}
	replays, replayErr := s.replay.ReplaySessions(ctx, site.ID, rangeValue, time.Now().UTC())
	replaySummary := map[string]any{"available": replayErr == nil}
	if replayErr == nil {
		lastReplay := ""
		if len(replays.Sessions) > 0 {
			lastReplay = replays.Sessions[0].UpdatedAt
		}
		replaySummary = map[string]any{
			"available":     true,
			"sessionCount":  len(replays.Sessions),
			"lastUpdatedAt": lastReplay,
		}
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Loaded data freshness for %s.", neoLabelForSite(site)),
		Highlights: []string{neoSiteStatsFreshness(stats)},
		Freshness:  neoSiteStatsFreshness(stats),
		Confidence: "high",
		Privacy:    "Freshness checks use timestamps and counts only.",
		Scope:      map[string]any{"siteId": site.ID, "range": rangeValue.String()},
		Data: map[string]any{
			"siteStats": map[string]any{
				"firstSeen":    stats.FirstSeen,
				"lastSeen":     stats.LastSeen,
				"totalEvents":  stats.TotalEvents,
				"trackedPages": stats.TrackedPages,
			},
			"replays": replaySummary,
		},
	}, nil
}

func (s *Server) neoToolGetIntegrationStatus(_ context.Context, access *neoAccessContext, _ map[string]any) (neoToolResult, error) {
	providers := s.neoAvailableProviderMetadata()
	return neoToolResult{
		OK:         true,
		Summary:    "Loaded backend integration status.",
		Highlights: []string{fmt.Sprintf("Storage backend: %s", s.cfg.Storage), fmt.Sprintf("AI providers: %d available", len(providers))},
		Confidence: "high",
		Privacy:    "Status output reports service connectivity only.",
		Scope:      map[string]any{"siteId": access.CurrentSite.ID},
		Data: map[string]any{
			"storage": map[string]any{
				"analytics":              s.cfg.Storage,
				"controlPlaneConfigured": s.neonPool != nil,
			},
			"tracker": map[string]any{
				"publicOrigin":   s.cfg.TrackerPublicOrigin,
				"snapshotOrigin": s.cfg.SnapshotPublicOrigin,
			},
			"providers": providers,
		},
	}, nil
}

func (s *Server) neoToolUpdateProfileName(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	if access.Viewer == nil || strings.TrimSpace(access.Viewer.ID) == "" {
		return neoToolResult{}, errors.New("profile updates require a viewer id in the Neo request context")
	}
	if s.neonPool == nil {
		return neoToolResult{}, errors.New("profile updates require control-plane storage")
	}

	fullName := truncateNeoText(neoStringArg(args, "fullName"), 120)
	if fullName == "" {
		return neoToolResult{}, errors.New("a non-empty full name is required")
	}
	if _, err := s.neonPool.Exec(ctx, `UPDATE app_users SET full_name = $1, updated_at = now() WHERE id = $2`, fullName, access.Viewer.ID); err != nil {
		return neoToolResult{}, err
	}
	access.Viewer.FullName = fullName
	if err := s.logNeoAction(ctx, neoActionLog{
		ActionKey:      neoApprovalKey("update_profile_name", access.CurrentSite.ID, args),
		SiteID:         access.CurrentSite.ID,
		ActorUserID:    access.Viewer.ID,
		ActionType:     "update_profile_name",
		ActionLevel:    neoAccessSafeWrite,
		TargetType:     "viewer",
		TargetID:       access.Viewer.ID,
		Status:         "completed",
		Summary:        "Updated the current viewer profile name.",
		RequestPayload: args,
		ResultPayload:  map[string]any{"fullName": fullName},
	}); err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Updated the viewer profile name to %s.", fullName),
		Highlights: []string{"Safe-write action logged."},
		Confidence: "high",
		Privacy:    "Only the viewer profile name was changed.",
		Scope:      map[string]any{"viewerId": access.Viewer.ID},
		Data:       access.Viewer,
	}, nil
}

func (s *Server) neoToolRegenerateTrackerScript(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	script, err := s.neoRegenerateTrackerScript(ctx, access.RequestOrigin, site)
	if err != nil {
		return neoToolResult{}, err
	}
	if err := s.logNeoAction(ctx, neoActionLog{
		ActionKey:      neoApprovalKey("regenerate_tracker_script", site.ID, args),
		SiteID:         site.ID,
		ActorUserID:    neoViewerID(access.Viewer),
		ActionType:     "regenerate_tracker_script",
		ActionLevel:    neoAccessSafeWrite,
		TargetType:     "site",
		TargetID:       site.ID,
		Status:         "completed",
		Summary:        "Regenerated the tracker script.",
		RequestPayload: args,
		ResultPayload:  map[string]any{"scriptSrc": script.ScriptSrc, "updatedAt": script.UpdatedAt},
	}); err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Regenerated the tracker script for %s.", neoLabelForSite(site)),
		Highlights: []string{"Safe-write action logged.", fmt.Sprintf("Persisted: %t", script.IsPersisted)},
		Confidence: "high",
		Privacy:    "Tracker output stays scoped to the current site.",
		Scope:      map[string]any{"siteId": site.ID},
		Data:       script,
	}, nil
}

func (s *Server) neoToolUpdatePrivacySettings(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	updatedSite, err := s.neoUpdatePrivacySettings(ctx, site, neoBoolArg(args, "domSnapshotsEnabled", site.DomSnapshotsEnabled), neoBoolArg(args, "visitorCookieEnabled", site.VisitorCookieEnabled))
	if err != nil {
		return neoToolResult{}, err
	}
	if site.ID == access.CurrentSite.ID {
		access.CurrentSite = updatedSite
	}
	if err := s.logNeoAction(ctx, neoActionLog{
		ActionKey:      neoApprovalKey("update_privacy_settings", site.ID, args),
		SiteID:         site.ID,
		ActorUserID:    neoViewerID(access.Viewer),
		ActionType:     "update_privacy_settings",
		ActionLevel:    neoAccessSafeWrite,
		TargetType:     "site",
		TargetID:       site.ID,
		Status:         "completed",
		Summary:        "Updated site privacy settings.",
		RequestPayload: args,
		ResultPayload: map[string]any{
			"domSnapshotsEnabled":  updatedSite.DomSnapshotsEnabled,
			"visitorCookieEnabled": updatedSite.VisitorCookieEnabled,
		},
	}); err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Updated privacy settings for %s.", neoLabelForSite(updatedSite)),
		Highlights: []string{"Safe-write action logged."},
		Confidence: "high",
		Privacy:    "Only privacy configuration was changed.",
		Scope:      map[string]any{"siteId": updatedSite.ID},
		Data: map[string]any{
			"domSnapshotsEnabled":  updatedSite.DomSnapshotsEnabled,
			"visitorCookieEnabled": updatedSite.VisitorCookieEnabled,
		},
	}, nil
}

func (s *Server) neoToolCreateBillingAdjustmentRequest(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	kind := firstNonEmpty(neoStringArg(args, "kind"), "credit")
	reason := truncateNeoText(neoStringArg(args, "reason"), 280)
	if reason == "" {
		return neoToolResult{}, errors.New("a reason is required")
	}
	summary := fmt.Sprintf("Queue a %s request for %s.", kind, neoLabelForSite(site))
	confirmation, err := s.requireNeoApproval(ctx, access, "create_billing_adjustment_request", args, summary)
	if err != nil {
		return neoToolResult{}, err
	}
	if confirmation != nil {
		return neoToolResult{
			OK:           false,
			Summary:      "This billing remediation request is restricted and needs explicit approval first.",
			Highlights:   []string{summary},
			Privacy:      "Restricted actions are never executed without approval.",
			Confirmation: confirmation,
		}, nil
	}
	result := map[string]any{
		"kind":     kind,
		"reason":   reason,
		"amount":   neoStringArg(args, "amount"),
		"currency": neoStringArg(args, "currency"),
		"notes":    truncateNeoText(neoStringArg(args, "notes"), 280),
		"status":   "queued",
	}
	if err := s.logNeoAction(ctx, neoActionLog{
		ActionKey:      neoApprovalKey("create_billing_adjustment_request", site.ID, args),
		SiteID:         site.ID,
		ActorUserID:    neoViewerID(access.Viewer),
		ActionType:     "create_billing_adjustment_request",
		ActionLevel:    neoAccessRestricted,
		TargetType:     "site",
		TargetID:       site.ID,
		Status:         "queued",
		Summary:        summary,
		RequestPayload: args,
		ResultPayload:  result,
	}); err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    fmt.Sprintf("Queued the %s request for follow-up.", kind),
		Highlights: []string{"Restricted action approved and logged."},
		Confidence: "medium",
		Privacy:    "Only the support request metadata was queued.",
		Scope:      map[string]any{"siteId": site.ID},
		Data:       result,
	}, nil
}

func (s *Server) neoToolCreateCustomerServiceHandoff(ctx context.Context, access *neoAccessContext, args map[string]any) (neoToolResult, error) {
	site := s.neoResolveSite(access, neoStringArg(args, "siteId"))
	reason := truncateNeoText(neoStringArg(args, "reason"), 280)
	if reason == "" {
		return neoToolResult{}, errors.New("a handoff reason is required")
	}
	summary := fmt.Sprintf("Queue a customer-service handoff for %s.", neoLabelForSite(site))
	confirmation, err := s.requireNeoApproval(ctx, access, "create_customer_service_handoff", args, summary)
	if err != nil {
		return neoToolResult{}, err
	}
	if confirmation != nil {
		return neoToolResult{
			OK:           false,
			Summary:      "The customer-service handoff is restricted and needs explicit approval first.",
			Highlights:   []string{summary},
			Privacy:      "Restricted actions are never executed without approval.",
			Confirmation: confirmation,
		}, nil
	}
	result := map[string]any{
		"reason":          reason,
		"customerMessage": truncateNeoText(neoStringArg(args, "customerMessage"), 600),
		"priority":        firstNonEmpty(neoStringArg(args, "priority"), "normal"),
		"status":          "queued",
	}
	if err := s.logNeoAction(ctx, neoActionLog{
		ActionKey:      neoApprovalKey("create_customer_service_handoff", site.ID, args),
		SiteID:         site.ID,
		ActorUserID:    neoViewerID(access.Viewer),
		ActionType:     "create_customer_service_handoff",
		ActionLevel:    neoAccessRestricted,
		TargetType:     "site",
		TargetID:       site.ID,
		Status:         "queued",
		Summary:        summary,
		RequestPayload: args,
		ResultPayload:  result,
	}); err != nil {
		return neoToolResult{}, err
	}
	return neoToolResult{
		OK:         true,
		Summary:    "Queued the customer-service handoff.",
		Highlights: []string{"Restricted action approved and logged."},
		Confidence: "medium",
		Privacy:    "Only the support handoff metadata was queued.",
		Scope:      map[string]any{"siteId": site.ID},
		Data:       result,
	}, nil
}

func (s *Server) neoResolveSite(access *neoAccessContext, requestedSiteID string) config.Site {
	requestedSiteID = strings.TrimSpace(requestedSiteID)
	if requestedSiteID == "" {
		return access.CurrentSite
	}
	for _, site := range access.Sites {
		if site.ID == requestedSiteID {
			return site
		}
	}
	return access.CurrentSite
}

func neoTopPageLabel(pages []storage.PageMetric) string {
	if len(pages) == 0 {
		return "none"
	}
	return pages[0].Path
}

func neoTopReferrerLabel(referrers []storage.ReferrerMetric) string {
	if len(referrers) == 0 {
		return "none"
	}
	return referrers[0].Source
}

func neoFindPageMetric(pages []storage.PageMetric, path string) storage.PageMetric {
	for _, page := range pages {
		if page.Path == path {
			return page
		}
	}
	return storage.PageMetric{Path: path}
}

func neoHeadSlice[T any](values []T, limit int) []T {
	if limit <= 0 || len(values) <= limit {
		return slices.Clone(values)
	}
	return slices.Clone(values[:limit])
}

func neoTailSlice[T any](values []T, limit int) []T {
	if limit <= 0 || len(values) <= limit {
		return slices.Clone(values)
	}
	return slices.Clone(values[len(values)-limit:])
}

func neoEventExplorerData(view storage.EventExplorerView, err error) map[string]any {
	if err != nil {
		return map[string]any{"available": false}
	}
	return map[string]any{
		"available": true,
		"summary":   view.Summary,
		"families":  neoHeadSlice(view.Families, 6),
		"catalog":   neoHeadSlice(view.Catalog, 6),
	}
}

func neoHeatmapSummaryData(view storage.HeatmapView, err error) map[string]any {
	if err != nil {
		return map[string]any{"available": false}
	}
	return map[string]any{
		"available":    true,
		"totals":       view.Totals,
		"confidence":   view.Confidence,
		"topSelectors": neoHeadSlice(view.Selectors, 6),
	}
}

func neoRetentionTrendData(view storage.RetentionTrendView, err error) map[string]any {
	if err != nil {
		return map[string]any{"available": false}
	}
	return map[string]any{
		"available": true,
		"summary":   view.Summary,
		"curve":     neoHeadSlice(view.Curve, 10),
	}
}

func neoDefaultIssues(issues []string, fallback string) []string {
	if len(issues) > 0 {
		return issues
	}
	return []string{fallback}
}

func neoSiteStatsFreshness(stats storage.SiteStats) string {
	if stats.LastSeen == nil {
		return "No events received yet."
	}
	age := time.Since(stats.LastSeen.UTC()).Round(time.Minute)
	if age < time.Minute {
		return "Last event received under a minute ago."
	}
	return fmt.Sprintf("Last event received %s ago.", age)
}

func neoHTTPRequest(origin string) *http.Request {
	request, _ := http.NewRequest(http.MethodGet, firstNonEmpty(origin, "http://localhost"), nil)
	return request
}

func neoFunnelStepsArg(args map[string]any, key string) ([]storage.FunnelStepDefinition, error) {
	raw, ok := args[key]
	if !ok {
		return nil, errors.New("steps are required")
	}
	items, ok := raw.([]any)
	if !ok || len(items) < 2 {
		return nil, errors.New("at least two funnel steps are required")
	}
	steps := make([]storage.FunnelStepDefinition, 0, len(items))
	for index, item := range items {
		object, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("step %d is invalid", index+1)
		}
		step := storage.FunnelStepDefinition{
			Label:     neoStringArg(object, "label"),
			Kind:      neoStringArg(object, "kind"),
			MatchType: neoStringArg(object, "matchType"),
			Value:     neoStringArg(object, "value"),
		}
		if step.Value == "" || storage.ParseFunnelStepKind(step.Kind) == "" || storage.ParseFunnelStepMatchType(step.MatchType) == "" {
			return nil, fmt.Errorf("step %d is incomplete", index+1)
		}
		steps = append(steps, step)
	}
	return steps, nil
}

func neoSegmentConditionsArg(args map[string]any, key string) []storage.SegmentCondition {
	raw, ok := args[key].([]any)
	if !ok {
		return nil
	}
	conditions := make([]storage.SegmentCondition, 0, len(raw))
	for _, item := range raw {
		object, ok := item.(map[string]any)
		if !ok {
			continue
		}
		conditions = append(conditions, neoSegmentConditionFromMap(object))
	}
	return conditions
}

func neoSegmentConditionFromMap(object map[string]any) storage.SegmentCondition {
	return storage.SegmentCondition{
		Type:        neoStringArg(object, "type"),
		Operator:    neoStringArg(object, "operator"),
		Value:       neoStringArg(object, "value"),
		PropertyKey: neoStringArg(object, "propertyKey"),
	}
}

func neoAlertChannelsArg(args map[string]any, key string) []alertChannelInput {
	raw, ok := args[key].([]any)
	if !ok {
		return nil
	}
	channels := make([]alertChannelInput, 0, len(raw))
	for _, item := range raw {
		object, ok := item.(map[string]any)
		if !ok {
			continue
		}
		config, _ := object["config"].(map[string]any)
		channels = append(channels, alertChannelInput{
			ID:      neoStringArg(object, "id"),
			Type:    neoStringArg(object, "type"),
			Name:    neoStringArg(object, "name"),
			Enabled: neoBoolArg(object, "enabled", true),
			Config:  config,
		})
	}
	return channels
}

func (s *Server) neoTrackerScript(ctx context.Context, requestOrigin string, site config.Site) (trackerScriptBlock, error) {
	if s.neonPool != nil {
		var script trackerScriptBlock
		var updatedAt *time.Time
		err := s.neonPool.QueryRow(ctx, `
			SELECT install_origin, collector_origin, script_src, script_tag, updated_at
			FROM analytics_site_scripts
			WHERE site_id = $1
			LIMIT 1
		`, site.ID).Scan(&script.InstallOrigin, &script.CollectorOrigin, &script.ScriptSrc, &script.ScriptTag, &updatedAt)
		if err == nil {
			script.SiteID = site.ID
			script.IsPersisted = true
			if updatedAt != nil {
				value := updatedAt.UTC().Format(time.RFC3339)
				script.UpdatedAt = &value
			}
			return script, nil
		}
	}
	request := neoHTTPRequest(requestOrigin)
	script := s.trackerScript(request, site)
	return script, nil
}

func (s *Server) neoRegenerateTrackerScript(ctx context.Context, requestOrigin string, site config.Site) (trackerScriptBlock, error) {
	request := neoHTTPRequest(requestOrigin)
	script := s.trackerScript(request, site)
	if s.neonPool == nil {
		return script, nil
	}
	var updatedAt time.Time
	err := s.neonPool.QueryRow(ctx, `
		INSERT INTO analytics_site_scripts (site_id, install_origin, collector_origin, script_src, script_tag, updated_at)
		VALUES ($1, $2, $3, $4, $5, now())
		ON CONFLICT (site_id) DO UPDATE
		SET install_origin = EXCLUDED.install_origin,
		    collector_origin = EXCLUDED.collector_origin,
		    script_src = EXCLUDED.script_src,
		    script_tag = EXCLUDED.script_tag,
		    updated_at = now()
		RETURNING updated_at
	`, site.ID, script.InstallOrigin, script.CollectorOrigin, script.ScriptSrc, script.ScriptTag).Scan(&updatedAt)
	if err != nil {
		return trackerScriptBlock{}, err
	}
	script.IsPersisted = true
	value := updatedAt.UTC().Format(time.RFC3339)
	script.UpdatedAt = &value
	return script, nil
}

func (s *Server) neoUpdatePrivacySettings(ctx context.Context, site config.Site, domSnapshotsEnabled, visitorCookieEnabled bool) (config.Site, error) {
	if s.neonPool == nil {
		return config.Site{}, errors.New("privacy updates require control-plane storage")
	}
	if _, err := s.neonPool.Exec(ctx, `
		INSERT INTO analytics_site_settings (site_id, dom_snapshots_enabled, visitor_cookie_enabled, updated_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (site_id) DO UPDATE
		SET dom_snapshots_enabled = EXCLUDED.dom_snapshots_enabled,
		    visitor_cookie_enabled = EXCLUDED.visitor_cookie_enabled,
		    updated_at = now()
	`, site.ID, domSnapshotsEnabled, visitorCookieEnabled); err != nil {
		return config.Site{}, err
	}
	updated := site
	updated.DomSnapshotsEnabled = domSnapshotsEnabled
	updated.VisitorCookieEnabled = visitorCookieEnabled
	return updated, nil
}

func (s *Server) neoListSitePages(ctx context.Context, siteID string, rangeValue storage.TimeRange) ([]map[string]any, string, error) {
	if s.neonPool != nil {
		rows, err := s.neonPool.Query(ctx, `
			SELECT path, source, last_seen_at
			FROM analytics_site_pages
			WHERE site_id = $1
			ORDER BY CASE WHEN path = '/' THEN 0 ELSE 1 END, char_length(path) ASC, path ASC
		`, siteID)
		if err == nil {
			defer rows.Close()
			pages := []map[string]any{}
			for rows.Next() {
				var path, source string
				var lastSeenAt *time.Time
				if scanErr := rows.Scan(&path, &source, &lastSeenAt); scanErr != nil {
					return nil, "", scanErr
				}
				entry := map[string]any{"path": path, "source": source}
				if lastSeenAt != nil {
					entry["lastSeenAt"] = lastSeenAt.UTC().Format(time.RFC3339)
				}
				pages = append(pages, entry)
			}
			if rowsErr := rows.Err(); rowsErr != nil {
				return nil, "", rowsErr
			}
			if len(pages) > 0 {
				return pages, "control-plane", nil
			}
		}
	}
	summary, err := s.dashboard.DashboardSummary(ctx, siteID, rangeValue, time.Now().UTC())
	if err != nil {
		return nil, "", err
	}
	pages := make([]map[string]any, 0, len(summary.Pages))
	for _, page := range summary.Pages {
		pages = append(pages, map[string]any{"path": page.Path, "pageviews": page.Pageviews, "source": "analytics-top-pages"})
	}
	return pages, "analytics-top-pages", nil
}
