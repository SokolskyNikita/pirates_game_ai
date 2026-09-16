import type { ComparisonRequest, ComparisonResponse, ScenarioRequest, ScenarioResponse } from './types';

async function post<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  let data: { error?: string } & T;
  try {
    data = await response.json();
  } catch {
    throw new Error('The calculation service returned an unreadable response.');
  }
  if (!response.ok || data.error)
    throw new Error(data.error || 'The calculation service is temporarily unavailable.');
  return data;
}
export async function simulateScenario(request: ScenarioRequest, signal: AbortSignal) {
  const response = await post<ScenarioResponse>('/api/simulate', request, signal);
  if (!response.snapshot || response.id !== request.id)
    throw new Error('The calculation service returned an unexpected scenario.');
  return response;
}
export function comparePolicy(request: ComparisonRequest, signal: AbortSignal) {
  return post<ComparisonResponse>('/api/compare', request, signal);
}
