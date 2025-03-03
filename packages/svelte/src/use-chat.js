import { derived, get, writable } from 'svelte/store';
import { callChatApi, extractMaxToolInvocationStep, fillMessageParts, generateId as generateIdFunc, getMessageParts, isAssistantMessageWithCompletedToolCalls, prepareAttachmentsForRequest, shouldResubmitMessages, updateToolCallResult, } from '@ai-sdk/ui-utils';
import { useSWR } from 'sswr';
const streamProtocolNew = writable('data');
export function setStreamProtocol(newProtocol) {
    streamProtocolNew.set(newProtocol);
}
const store = {};
export function useChat({ api = '/api/chat', id, initialMessages = [], initialInput = '', sendExtraMessageFields, streamProtocol = 'data', onResponse, onFinish, onError, onToolCall, credentials, headers, body, generateId = generateIdFunc, fetch, keepLastMessageOnError = true, maxSteps = 1, } = {}) {
    // Generate a unique id for the chat if not provided.
    const chatId = id !== null && id !== void 0 ? id : generateId();
    const key = `${api}|${chatId}`;
    const { data, mutate: originalMutate } = useSWR(key, {
        fetcher: () => { var _a; return (_a = store[key]) !== null && _a !== void 0 ? _a : fillMessageParts(initialMessages); },
        fallbackData: fillMessageParts(initialMessages),
    });
    const streamData = writable(undefined);
    const status = writable('ready');
    // Force the `data` to be `initialMessages` if it's `undefined`.
    data.set(fillMessageParts(initialMessages));
    const mutate = (data) => {
        store[key] = data;
        return originalMutate(data);
    };
    // Because of the `fallbackData` option, the `data` will never be `undefined`.
    const messages = data;
    // Abort controller to cancel the current API call.
    let abortController = null;
    const extraMetadata = {
        credentials,
        headers,
        body,
    };
    const error = writable(undefined);
    // Actual mutation hook to send messages to the API endpoint and update the
    // chat state.
    async function triggerRequest(chatRequest) {
        var _a;
        status.set('submitted');
        error.set(undefined);
        const messagesSnapshot = get(messages);
        const messageCount = messagesSnapshot.length;
        const maxStep = extractMaxToolInvocationStep((_a = chatRequest.messages[chatRequest.messages.length - 1]) === null || _a === void 0 ? void 0 : _a.toolInvocations);
        try {
            abortController = new AbortController();
            // Do an optimistic update to the chat state to show the updated messages
            // immediately.
            const chatMessages = fillMessageParts(chatRequest.messages);
            mutate(chatMessages);
            const existingData = get(streamData);
            const previousMessages = get(messages);
            const constructedMessagesPayload = sendExtraMessageFields
                ? chatMessages
                : chatMessages.map(({ role, content, experimental_attachments, data, annotations, toolInvocations, parts, }) => ({
                    role,
                    content,
                    ...(experimental_attachments !== undefined && {
                        experimental_attachments,
                    }),
                    ...(data !== undefined && { data }),
                    ...(annotations !== undefined && { annotations }),
                    ...(toolInvocations !== undefined && { toolInvocations }),
                    ...(parts !== undefined && { parts }),
                }));
            await callChatApi({
                api,
                body: {
                    id: chatId,
                    messages: constructedMessagesPayload,
                    data: chatRequest.data,
                    ...extraMetadata.body,
                    ...chatRequest.body,
                },
                streamProtocol: get(streamProtocolNew),
                credentials: extraMetadata.credentials,
                headers: {
                    ...extraMetadata.headers,
                    ...chatRequest.headers,
                },
                abortController: () => abortController,
                restoreMessagesOnFailure() {
                    if (!keepLastMessageOnError) {
                        mutate(previousMessages);
                    }
                },
                onResponse,
                onUpdate({ message, data, replaceLastMessage }) {
                    status.set('streaming');
                    mutate([
                        ...(replaceLastMessage
                            ? chatMessages.slice(0, chatMessages.length - 1)
                            : chatMessages),
                        message,
                    ]);
                    if (data === null || data === void 0 ? void 0 : data.length) {
                        streamData.set([...(existingData !== null && existingData !== void 0 ? existingData : []), ...data]);
                    }
                },
                onFinish,
                generateId,
                onToolCall,
                fetch,
                lastMessage: chatMessages[chatMessages.length - 1],
            });
            status.set('ready');
        }
        catch (err) {
            // Ignore abort errors as they are expected.
            if (err.name === 'AbortError') {
                abortController = null;
                status.set('ready');
                return null;
            }
            if (onError && err instanceof Error) {
                onError(err);
            }
            error.set(err);
            status.set('error');
        }
        finally {
            abortController = null;
        }
        // auto-submit when all tool calls in the last assistant message have results:
        const newMessagesSnapshot = get(messages);
        if (shouldResubmitMessages({
            originalMaxToolInvocationStep: maxStep,
            originalMessageCount: messageCount,
            maxSteps,
            messages: newMessagesSnapshot,
        })) {
            await triggerRequest({ messages: newMessagesSnapshot });
        }
    }
    const append = async (message, { data, headers, body, experimental_attachments } = {}) => {
        var _a, _b;
        const attachmentsForRequest = await prepareAttachmentsForRequest(experimental_attachments);
        return triggerRequest({
            messages: get(messages).concat({
                ...message,
                id: (_a = message.id) !== null && _a !== void 0 ? _a : generateId(),
                createdAt: (_b = message.createdAt) !== null && _b !== void 0 ? _b : new Date(),
                experimental_attachments: attachmentsForRequest.length > 0 ? attachmentsForRequest : undefined,
                parts: getMessageParts(message),
            }),
            headers,
            body,
            data,
        });
    };
    const reload = async ({ data, headers, body, } = {}) => {
        const messagesSnapshot = get(messages);
        if (messagesSnapshot.length === 0) {
            return null;
        }
        // Remove last assistant message and retry last user message.
        const lastMessage = messagesSnapshot.at(-1);
        return triggerRequest({
            messages: (lastMessage === null || lastMessage === void 0 ? void 0 : lastMessage.role) === 'assistant'
                ? messagesSnapshot.slice(0, -1)
                : messagesSnapshot,
            headers,
            body,
            data,
        });
    };
    const stop = () => {
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
    };
    const setMessages = (messagesArg) => {
        if (typeof messagesArg === 'function') {
            messagesArg = messagesArg(get(messages));
        }
        mutate(fillMessageParts(messagesArg));
    };
    const setData = (dataArg) => {
        if (typeof dataArg === 'function') {
            dataArg = dataArg(get(streamData));
        }
        streamData.set(dataArg);
    };
    const input = writable(initialInput);
    const handleSubmit = async (event, options = {}) => {
        var _a;
        (_a = event === null || event === void 0 ? void 0 : event.preventDefault) === null || _a === void 0 ? void 0 : _a.call(event);
        const inputValue = get(input);
        if (!inputValue && !options.allowEmptySubmit)
            return;
        const attachmentsForRequest = await prepareAttachmentsForRequest(options.experimental_attachments);
        triggerRequest({
            messages: get(messages).concat({
                id: generateId(),
                content: inputValue,
                role: 'user',
                createdAt: new Date(),
                experimental_attachments: attachmentsForRequest.length > 0 ? attachmentsForRequest : undefined,
                parts: [{ type: 'text', text: inputValue }],
            }),
            body: options.body,
            headers: options.headers,
            data: options.data,
        });
        input.set('');
    };
    const addToolResult = ({ toolCallId, result, }) => {
        var _a;
        const messagesSnapshot = (_a = get(messages)) !== null && _a !== void 0 ? _a : [];
        updateToolCallResult({
            messages: messagesSnapshot,
            toolCallId,
            toolResult: result,
        });
        messages.set(messagesSnapshot);
        // auto-submit when all tool calls in the last assistant message have results:
        const lastMessage = messagesSnapshot[messagesSnapshot.length - 1];
        if (isAssistantMessageWithCompletedToolCalls(lastMessage)) {
            triggerRequest({ messages: messagesSnapshot });
        }
    };
    return {
        id: chatId,
        messages,
        error,
        append,
        reload,
        stop,
        setMessages,
        input,
        handleSubmit,
        isLoading: derived(status, $status => $status === 'submitted' || $status === 'streaming'),
        status,
        data: streamData,
        setData,
        addToolResult,
    };
}
