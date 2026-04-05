<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=UTF-8');
echo json_encode([
    'status' => 'ok',
    'service' => 'emergency-centre',
    'timestamp' => gmdate(DATE_ATOM),
], JSON_UNESCAPED_UNICODE);
