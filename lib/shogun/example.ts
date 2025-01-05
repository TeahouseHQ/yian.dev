import { GameStateMachine } from "./gameState";
import { ActionTypes } from "./types";

const game = new GameStateMachine();

// Move player right
game.dispatch(ActionTypes.MOVE, { unitId: "player", direction: 1 });

// Change player orientation to face left
game.dispatch(ActionTypes.CHANGE_ORIENTATION, { unitId: "player", orientation: -1 });

// Queue an attack for player
game.dispatch(ActionTypes.QUEUE_ATTACK, { unitId: "player", attack: "slash" });

// Execute the queued attack
game.dispatch(ActionTypes.EXECUTE_ATTACK, { unitId: "player" });

// Move an enemy (index 0)
game.dispatch(ActionTypes.MOVE, { unitId: 0, direction: -1 });

console.log(game.getState());
