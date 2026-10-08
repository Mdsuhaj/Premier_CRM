<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Sent to System Admin(s) when an Admin submits a stock allocation on the
 * Marketing Review (Batches) page — i.e. clicks "Approval" as Admin, which
 * saves & submits the allocation for System Admin's decision.
 *
 * Flow: ADMIN -> Allots (Allocates) Order -> CRM updates Order -> Email -> System Admin
 */
class AllocationSubmittedMail extends Mailable
{
    use Queueable, SerializesModels;

    /**
     * @param string $productName
     * @param array<int, array{orderCode: string, customerName: string, allocatedQty: int}> $rows
     */
    public function __construct(
        public string $productName,
        public array $rows,
    ) {
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Allocation Submitted for Review — ' . $this->productName,
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.allocation-submitted',
            with: [
                'productName' => $this->productName,
                'rows' => $this->rows,
            ],
        );
    }
}
