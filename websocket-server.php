<?php
declare(strict_types=1);

$host = '0.0.0.0';
$port = (int) (getenv('PORT') ?: 8081);
$path = '/' . trim((string) (getenv('WEBSOCKET_PATH') ?: 'ws'), '/');

$server = stream_socket_server("tcp://{$host}:{$port}", $errno, $errstr);
if ($server === false) {
    fwrite(STDERR, "WebSocket server failed: {$errstr} ({$errno})\n");
    exit(1);
}

stream_set_blocking($server, false);
$clients = [];

function sendFrame($client, string $payload, int $opcode = 0x1): bool
{
    $length = strlen($payload);
    $frame = chr(0x80 | $opcode);

    if ($length <= 125) {
        $frame .= chr($length);
    } elseif ($length <= 65535) {
        $frame .= chr(126) . pack('n', $length);
    } else {
        $frame .= chr(127) . pack('NN', 0, $length);
    }

    return fwrite($client, $frame . $payload) !== false;
}

function decodeFrame(string $buffer): array
{
    $length = ord($buffer[1]) & 127;
    $maskOffset = 2;

    if ($length === 126) {
        $length = unpack('n', substr($buffer, 2, 2))[1];
        $maskOffset = 4;
    } elseif ($length === 127) {
        $lengthData = unpack('Nhigh/Nlow', substr($buffer, 2, 8));
        $length = (int) (($lengthData['high'] ?? 0) * 4294967296 + ($lengthData['low'] ?? 0));
        $maskOffset = 10;
    }

    $mask = substr($buffer, $maskOffset, 4);
    $payload = substr($buffer, $maskOffset + 4, $length);
    $decoded = '';

    for ($i = 0; $i < $length; $i++) {
        $decoded .= $payload[$i] ^ $mask[$i % 4];
    }

    return [
        'opcode' => ord($buffer[0]) & 0x0F,
        'payload' => $decoded,
    ];
}

function performHandshake($client, string $request, string $expectedPath): bool
{
    if (!preg_match('/GET\s+(\S+)\s+HTTP\/1\.1/i', $request, $pathMatch)) {
        return false;
    }

    $requestPath = parse_url($pathMatch[1], PHP_URL_PATH) ?: '/';
    if ($requestPath !== $expectedPath) {
        fwrite($client, "HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        return false;
    }

    if (!preg_match('/Sec-WebSocket-Key: (.*)\r\n/i', $request, $matches)) {
        return false;
    }

    $key = trim($matches[1]);
    $accept = base64_encode(pack('H*', sha1($key . '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')));

    $headers = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Accept: ' . $accept,
        "\r\n",
    ];

    fwrite($client, implode("\r\n", $headers));
    return true;
}

fwrite(STDOUT, "WebSocket server listening on {$host}:{$port}{$path}\n");

while (true) {
    $read = array_map(static fn(array $entry) => $entry['socket'], $clients);
    $read[] = $server;
    $write = null;
    $except = null;

    if (@stream_select($read, $write, $except, 1) === false) {
        continue;
    }

    foreach ($read as $socket) {
        if ($socket === $server) {
            $client = @stream_socket_accept($server, 0);
            if ($client === false) {
                continue;
            }

            stream_set_blocking($client, false);
            $clients[(int) $client] = [
                'socket' => $client,
                'handshake' => false,
            ];
            continue;
        }

        $clientId = (int) $socket;
        $buffer = @fread($socket, 8192);

        if ($buffer === '' || $buffer === false) {
            @fclose($socket);
            unset($clients[$clientId]);
            continue;
        }

        if ($clients[$clientId]['handshake'] === false) {
            $ok = performHandshake($socket, $buffer, $path);
            if (!$ok) {
                @fclose($socket);
                unset($clients[$clientId]);
                continue;
            }

            $clients[$clientId]['handshake'] = true;
            sendFrame($socket, json_encode([
                'type' => 'system',
                'message' => 'WebSocket connection established',
                'timestamp' => gmdate(DATE_ATOM),
            ], JSON_UNESCAPED_UNICODE));
            continue;
        }

        $frame = decodeFrame($buffer);
        if ($frame['opcode'] === 0x8) {
            @fclose($socket);
            unset($clients[$clientId]);
            continue;
        }

        if ($frame['opcode'] === 0x9) {
            sendFrame($socket, $frame['payload'], 0xA);
            continue;
        }

        $message = trim($frame['payload']);
        if ($message === '') {
            continue;
        }

        $payload = json_encode([
            'type' => 'broadcast',
            'message' => $message,
            'timestamp' => gmdate(DATE_ATOM),
        ], JSON_UNESCAPED_UNICODE);

        foreach ($clients as $peerId => $peer) {
            if ($peer['handshake'] === true) {
                sendFrame($peer['socket'], $payload);
            }
        }
    }
}
