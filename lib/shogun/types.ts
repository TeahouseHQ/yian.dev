export type Orientation = 1 | -1;

export interface Unit {
  health: number;
  orientation: Orientation;
  attackQueue: string[];
  position: number;
}

export interface GameState {
  player: Unit;
  enemies: Unit[];
  worldSize: number;
}

export enum ActionTypes {
  MOVE = "MOVE",
  CHANGE_ORIENTATION = "CHANGE_ORIENTATION",
  QUEUE_ATTACK = "QUEUE_ATTACK",
  EXECUTE_ATTACK = "EXECUTE_ATTACK",
}

export interface MovePayload {
  unitId: "player" | number; // number for enemy index
  direction: 1 | -1;
}

export interface OrientationPayload {
  unitId: "player" | number;
  orientation: Orientation;
}

export interface QueueAttackPayload {
  unitId: "player" | number;
  attack: string;
}

export interface ExecuteAttackPayload {
  unitId: "player" | number;
}
