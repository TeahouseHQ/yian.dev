import { StateMachine } from "./util/stateMachine";
import {
  ActionTypes,
  GameState,
  MovePayload,
  OrientationPayload,
  QueueAttackPayload,
  ExecuteAttackPayload,
  Unit,
} from "./types";

export class GameStateMachine extends StateMachine<GameState> {
  constructor() {
    // Initialize with default game state
    const initialState: GameState = {
      player: {
        health: 100,
        orientation: 1,
        attackQueue: [],
        position: 0,
      },
      enemies: [
        {
          health: 100,
          orientation: -1,
          attackQueue: [],
          position: 4,
        },
        {
          health: 100,
          orientation: -1,
          attackQueue: [],
          position: 6,
        },
      ],
      worldSize: 7,
    };

    super(initialState);
    this.registerGameActions();
  }

  private registerGameActions(): void {
    this.registerAction(ActionTypes.MOVE, (payload: MovePayload) => (state) => {
      const newState = { ...state };
      const unit = this.getUnitFromState(newState, payload.unitId);

      if (unit) {
        const newPosition = unit.position + payload.direction;
        if (this.isValidMove(newState, newPosition)) {
          unit.position = newPosition;
        }
      }

      return newState;
    });

    this.registerAction(
      ActionTypes.CHANGE_ORIENTATION,
      (payload: OrientationPayload) => (state) => {
        const newState = { ...state };
        const unit = this.getUnitFromState(newState, payload.unitId);

        if (unit) {
          unit.orientation = payload.orientation;
        }

        return newState;
      }
    );

    this.registerAction(ActionTypes.QUEUE_ATTACK, (payload: QueueAttackPayload) => (state) => {
      const newState = { ...state };
      const unit = this.getUnitFromState(newState, payload.unitId);

      if (unit) {
        unit.attackQueue.push(payload.attack);
      }

      return newState;
    });

    this.registerAction(ActionTypes.EXECUTE_ATTACK, (payload: ExecuteAttackPayload) => (state) => {
      const newState = { ...state };
      const unit = this.getUnitFromState(newState, payload.unitId);

      if (unit && unit.attackQueue.length > 0) {
        // Remove the first attack from the queue
        unit.attackQueue.shift();
        // TODO: implement the actual attack logic
      }

      return newState;
    });
  }

  private getUnitFromState(state: GameState, unitId: "player" | number): Unit | null {
    if (unitId === "player") {
      return state.player;
    }
    return state.enemies[unitId] || null;
  }

  private isValidMove(state: GameState, newPosition: number): boolean {
    // Check if position is within world bounds
    if (newPosition < 0 || newPosition >= state.worldSize) {
      return false;
    }

    // Check if position is occupied
    if (state.player.position === newPosition) {
      return false;
    }

    if (state.enemies.some((enemy) => enemy.position === newPosition)) {
      return false;
    }

    return true;
  }
}
