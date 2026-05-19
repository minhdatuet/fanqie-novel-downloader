import type { JobStatus, ProgressState } from "../types.js";

const POST_PROCESS_OFFSET = 1;

export function progress(current: number, total: number, message: string): ProgressState
{
    const safeTotal = Math.max(1, total);
    const safeCurrent = Math.min(Math.max(0, current), safeTotal);

    return {
        current: safeCurrent,
        message,
        percent: Math.round((safeCurrent / safeTotal) * 100),
        total: safeTotal
    };
}

export function workingProgress(current: number, total: number, message: string): ProgressState
{
    const state = progress(current, total, message);

    return {
        ...state,
        percent: Math.min(99, Math.floor((state.current / state.total) * 100))
    };
}

export function displayProgress(
    current: number,
    total: number,
    message: string,
    status?: JobStatus
): ProgressState
{
    const state = progress(current, total, message);

    if (status === "queued" || status === "running")
    {
        return {
            ...state,
            percent: Math.min(99, state.percent)
        };
    }

    return state;
}

export function postProcessProgress(baseTotal: number, message: string): ProgressState
{
    return workingProgress(Math.max(0, baseTotal), Math.max(1, baseTotal + POST_PROCESS_OFFSET), message);
}
