import { isAbortError } from '@ai-sdk/provider-utils';
import { generateId, processAssistantStream } from '@ai-sdk/ui-utils';
import { get, writable } from 'svelte/store';
// use function to allow for mocking in tests:
const getOriginalFetch = () => fetch;
let uniqueId = 0;
const store = {};
export function useAssistant({ api, threadId: threadIdParam, credentials, headers, body, onError, fetch, }) {
    // Generate a unique thread ID
    const threadIdStore = writable(threadIdParam);
    // Initialize message, input, status, and error stores
    const key = `${api}|${threadIdParam !== null && threadIdParam !== void 0 ? threadIdParam : `completion-${uniqueId++}`}`;
    const messages = writable(store[key] || []);
    const input = writable('');
    const status = writable('awaiting_message');
    const error = writable(undefined);
    // To manage aborting the current fetch request
    let abortController = null;
    // Update the message store
    const mutateMessages = (newMessages) => {
        store[key] = newMessages;
        messages.set(newMessages);
    };
    // Function to handle API calls and state management
    async function append(message, requestOptions) {
        var _a, _b, _c, _d;
        status.set('in_progress');
        abortController = new AbortController(); // Initialize a new AbortController
        // Add the new message to the existing array
        mutateMessages([
            ...get(messages),
            { ...message, id: (_a = message.id) !== null && _a !== void 0 ? _a : generateId() },
        ]);
        input.set('');
        try {
            const actualFetch = fetch !== null && fetch !== void 0 ? fetch : getOriginalFetch();
            const response = await actualFetch(api, {
                method: 'POST',
                credentials,
                signal: abortController.signal,
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({
                    ...body,
                    // always use user-provided threadId when available:
                    threadId: (_b = threadIdParam !== null && threadIdParam !== void 0 ? threadIdParam : get(threadIdStore)) !== null && _b !== void 0 ? _b : null,
                    message: message.content,
                    // optional request data:
                    data: requestOptions === null || requestOptions === void 0 ? void 0 : requestOptions.data,
                }),
            });
            if (!response.ok) {
                throw new Error((_c = (await response.text())) !== null && _c !== void 0 ? _c : 'Failed to fetch the assistant response.');
            }
            if (response.body == null) {
                throw new Error('The response body is empty.');
            }
            await processAssistantStream({
                stream: response.body,
                onAssistantMessagePart(value) {
                    mutateMessages([
                        ...get(messages),
                        {
                            id: value.id,
                            role: value.role,
                            content: value.content[0].text.value,
                            parts: [],
                        },
                    ]);
                },
                onTextPart(value) {
                    // text delta - add to last message:
                    mutateMessages(get(messages).map((msg, index, array) => {
                        if (index === array.length - 1) {
                            return { ...msg, content: msg.content + value };
                        }
                        return msg;
                    }));
                },
                onAssistantControlDataPart(value) {
                    threadIdStore.set(value.threadId);
                    mutateMessages(get(messages).map((msg, index, array) => {
                        if (index === array.length - 1) {
                            return { ...msg, id: value.messageId };
                        }
                        return msg;
                    }));
                },
                onDataMessagePart(value) {
                    var _a;
                    mutateMessages([
                        ...get(messages),
                        {
                            id: (_a = value.id) !== null && _a !== void 0 ? _a : generateId(),
                            role: 'data',
                            content: '',
                            data: value.data,
                            parts: [],
                        },
                    ]);
                },
                onErrorPart(value) {
                    error.set(new Error(value));
                },
            });
        }
        catch (err) {
            // Ignore abort errors as they are expected when the user cancels the request:
            if (isAbortError(error) && ((_d = abortController === null || abortController === void 0 ? void 0 : abortController.signal) === null || _d === void 0 ? void 0 : _d.aborted)) {
                abortController = null;
                return;
            }
            if (onError && err instanceof Error) {
                onError(err);
            }
            error.set(err);
        }
        finally {
            abortController = null;
            status.set('awaiting_message');
        }
    }
    function setMessages(messages) {
        mutateMessages(messages);
    }
    function stop() {
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
    }
    // Function to handle form submission
    async function submitMessage(event, requestOptions) {
        var _a;
        (_a = event === null || event === void 0 ? void 0 : event.preventDefault) === null || _a === void 0 ? void 0 : _a.call(event);
        const inputValue = get(input);
        if (!inputValue)
            return;
        await append({ role: 'user', content: inputValue, parts: [] }, requestOptions);
    }
    return {
        messages,
        error,
        threadId: threadIdStore,
        input,
        append,
        submitMessage,
        status,
        setMessages,
        stop,
    };
}
