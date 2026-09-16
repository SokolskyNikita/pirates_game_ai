import { solveScenario, type ScenarioRequest, type ScenarioResponse } from './simulation';

self.addEventListener('message', (event: MessageEvent<ScenarioRequest>) => {
  const request = event.data;
  let response: ScenarioResponse;
  try {
    response = { id: request.id, snapshot: solveScenario(request) };
  } catch (error) {
    response = { id: request.id, error: error instanceof Error ? error.message : 'The calculation could not finish.' };
  }
  self.postMessage(response);
});
