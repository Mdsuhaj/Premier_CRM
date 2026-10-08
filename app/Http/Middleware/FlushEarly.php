<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Lets the browser finish a write request (POST/PUT/PATCH/DELETE) as soon as the
 * JSON body has been sent, instead of waiting for work Laravel does in
 * terminating callbacks (e-mail notifications).
 */
class FlushEarly
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        if (
            !$request->isMethod('GET') && !$request->isMethod('HEAD')
            && !$request->is('api/login')
            && $response instanceof JsonResponse
            && !$response->headers->has('Content-Length')
            && !headers_sent()
        ) {
            ignore_user_abort(true);
            $body = $response->getContent();
            if ($body !== false) {
                $response->headers->set('Content-Length', (string) strlen($body));
            }
        }

        return $response;
    }
}