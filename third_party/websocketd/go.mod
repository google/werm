module websocketd

go 1.15

require libwebsocketd v0.0.0

replace libwebsocketd v0.0.0 => ./libwebsocketd

require gorillaws v0.0.0

replace gorillaws v0.0.0 => ./third_party/gorillaws
