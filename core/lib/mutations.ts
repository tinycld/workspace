import type { Transaction } from '@tanstack/react-db'
import {
    type UseMutationOptions,
    type UseMutationResult,
    useMutation as useTanStackMutation,
} from '@tanstack/react-query'

/**
 * Awaits each yielded Transaction sequentially, or an array of Transactions in parallel.
 *
 * @example
 * ```ts
 * await performMutations(function* () {
 *   yield addressesCollection.insert({ id: newRecordId(), ... })
 *   yield customersCollection.insert({ id: newRecordId(), ... })
 * })
 * ```
 */
export async function performMutations<TResult = void>(
    fn: () => Generator<
        Transaction<Record<string, unknown>> | Transaction<Record<string, unknown>>[],
        TResult,
        void
    >
): Promise<TResult> {
    const gen = fn()

    let result = gen.next()
    while (!result.done) {
        const value = result.value
        if (Array.isArray(value)) {
            await Promise.all(value.map(tx => tx.isPersisted.promise))
        } else {
            await value.isPersisted.promise
        }
        result = gen.next()
    }

    return result.value
}

type GeneratorMutationFn<TData, TVariables> = (
    variables: TVariables
) => Generator<
    Transaction<Record<string, unknown>> | Transaction<Record<string, unknown>>[],
    TData,
    void
>

type GeneratorMutationOptions<TData = unknown, TError = Error, TVariables = void> = Omit<
    UseMutationOptions<TData, TError, TVariables>,
    'mutationFn'
> & {
    mutationFn: GeneratorMutationFn<TData, TVariables>
}

type AsyncMutationOptions<TData = unknown, TError = Error, TVariables = void> = UseMutationOptions<
    TData,
    TError,
    TVariables
>

/**
 * Converts a generator function into an async function that awaits
 * each yielded Transaction via performMutations. Use this to wrap
 * generator-based mutationFn before passing to useMutation.
 *
 * @example
 * ```ts
 * const create = useMutation({
 *     mutationFn: mutation(function* (data: FormData) {
 *         yield contactsCollection.insert({ id: newRecordId(), ...data })
 *     }),
 * })
 * ```
 */
export function mutation<TData = void, TVariables = void>(
    genFn: GeneratorMutationFn<TData, TVariables>
): (variables: TVariables) => Promise<TData> {
    return (variables: TVariables) => performMutations(() => genFn(variables))
}

/**
 * Wraps TanStack Query's useMutation with support for generator-based mutation functions.
 * Generator functions are auto-wrapped with performMutations so each yielded
 * Transaction is awaited before proceeding.
 *
 * @example Generator-based (recommended for pbtsdb operations)
 * ```ts
 * const navigateBack = useNavigateBack(() => orgHref('contacts'))
 * const create = useMutation({
 *     mutationFn: function* (data: FormData) {
 *         yield contactsCollection.insert({ id: newRecordId(), ...data })
 *     },
 *     onSuccess: navigateBack,
 *     onError: handleMutationErrorsWithForm({ setError, getValues }),
 * })
 * ```
 *
 * @example Async (when you need non-pbtsdb async work)
 * ```ts
 * const create = useMutation({
 *     mutationFn: async (data: FormData) => {
 *         const geo = await geocode(data.address)
 *         await performMutations(function* () {
 *             yield contactsCollection.insert({ ...data, geo })
 *         })
 *     },
 * })
 * ```
 */
export function useMutation<TData = unknown, TError = Error, TVariables = void>(
    options:
        | GeneratorMutationOptions<TData, TError, TVariables>
        | AsyncMutationOptions<TData, TError, TVariables>
): UseMutationResult<TData, TError, TVariables> {
    const { mutationFn, ...restOptions } = options

    const isGeneratorFn = mutationFn && mutationFn.constructor.name === 'GeneratorFunction'

    const wrappedOptions = isGeneratorFn
        ? {
              ...restOptions,
              mutationFn: (variables: TVariables) =>
                  performMutations(() =>
                      (mutationFn as GeneratorMutationFn<TData, TVariables>)(variables)
                  ),
          }
        : (options as AsyncMutationOptions<TData, TError, TVariables>)

    return useTanStackMutation(wrappedOptions)
}
