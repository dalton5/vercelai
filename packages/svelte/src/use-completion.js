import { callCompletionApi } from '@ai-sdk/ui-utils';
import { useSWR } from 'sswr';
import { derived, get, writable } from 'svelte/store';
let uniqueId = 0;
const store = {};
export function useCompletion({ api = '/api/completion', id, initialCompletion = '', initialInput = '', credentials, headers, body, streamProtocol = 'data', onResponse, onFinish, onError, fetch, } = {}) {
    // Generate an unique id for the completion if not provided.
    const completionId = id || `completion-${uniqueId++}`;
    const key = `${api}|${completionId}`;
    const { data, mutate: originalMutate, isLoading: isSWRLoading, } = useSWR(key, {
        fetcher: () => store[key] || initialCompletion,
        fallbackData: initialCompletion,
    });
    const streamData = writable(undefined);
    const loading = writable(false);
    // Force the `data` to be `initialCompletion` if it's `undefined`.
    data.set(initialCompletion);
    const mutate = (data) => {
        store[key] = data;
        return originalMutate(data);
    };
    // Because of the `fallbackData` option, the `data` will never be `undefined`.
    const completion = data;
    const error = writable(undefined);
    let abortController = null;
    const complete = async (prompt, options) => {
        const existingData = get(streamData);
        return callCompletionApi({
            api,
            prompt,
            credentials,
            headers: {
                ...headers,
                ...options === null || options === void 0 ? void 0 : options.headers,
            },
            body: {
                ...body,
                ...options === null || options === void 0 ? void 0 : options.body,
            },
            streamProtocol,
            setCompletion: mutate,
            setLoading: loadingState => loading.set(loadingState),
            setError: err => error.set(err),
            setAbortController: controller => {
                abortController = controller;
            },
            onResponse,
            onFinish,
            onError,
            onData(data) {
                streamData.set([...(existingData || []), ...(data || [])]);
            },
            fetch,
        });
    };
    const stop = () => {
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
    };
    const setCompletion = (completion) => {
        mutate(completion);
    };
    const input = writable(initialInput);
    const handleSubmit = (event) => {
        var _a;
        (_a = event === null || event === void 0 ? void 0 : event.preventDefault) === null || _a === void 0 ? void 0 : _a.call(event);
        const inputValue = get(input);
        return inputValue ? complete(inputValue) : undefined;
    };
    const isLoading = derived([isSWRLoading, loading], ([$isSWRLoading, $loading]) => {
        return $isSWRLoading || $loading;
    });
    return {
        completion,
        complete,
        error,
        stop,
        setCompletion,
        input,
        handleSubmit,
        isLoading,
        data: streamData,
    };
}
