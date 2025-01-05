export interface Action<TPayload = any> {
  type: string;
  payload?: TPayload;
}

export type Reducer<TState, TPayload = any> = (state: TState, payload: TPayload) => TState;
