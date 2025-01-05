type StateTransitionFn<TState> = (currentState: TState) => TState;
type ActionHandler<TState> = (payload?: any) => StateTransitionFn<TState>;

export class StateMachine<TState> {
  private currentState: TState;
  private actions: Map<string, ActionHandler<TState>>;

  constructor(initialState: TState) {
    this.currentState = initialState;
    this.actions = new Map();
  }

  /**
   * Register a new action handler
   * @param actionType Unique identifier for the action
   * @param handler Function that returns a state transition function
   */
  registerAction(actionType: string, handler: ActionHandler<TState>): void {
    if (this.actions.has(actionType)) {
      throw new Error(`Action "${actionType}" is already registered`);
    }
    this.actions.set(actionType, handler);
  }

  /**
   * Dispatch an action to update the state
   * @param actionType The type of action to dispatch
   * @param payload Optional payload for the action
   * @returns The new state
   */
  dispatch(actionType: string, payload?: any): TState {
    const handler = this.actions.get(actionType);
    if (!handler) {
      throw new Error(`No handler registered for action "${actionType}"`);
    }

    const transition = handler(payload);
    this.currentState = transition(this.currentState);
    return this.currentState;
  }

  /**
   * Get the current state
   */
  getState(): TState {
    return this.currentState;
  }
}
