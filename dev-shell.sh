#! /bin/bash

SESH="yian_dev"

tmux has-session -t $SESH 2>/dev/null
if [ $? != 0 ]; then
  tmux new-session -d -s $SESH -n "dev"
  tmux send-keys -t $SESH:dev "nvm use" C-m
  tmux send-keys -t $SESH:dev "pnpm dev" C-m
  tmux split-window -h
fi

tmux attach -t $SESH
