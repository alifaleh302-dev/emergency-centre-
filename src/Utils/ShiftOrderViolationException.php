<?php
declare(strict_types=1);

class ShiftOrderViolationException extends RuntimeException
{
    private array $details;

    public function __construct(string $message, array $details)
    {
        parent::__construct($message, 409);
        $this->details = $details;
    }

    public function getDetails(): array
    {
        return $this->details;
    }
}
