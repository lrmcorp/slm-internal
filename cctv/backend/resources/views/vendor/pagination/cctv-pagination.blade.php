@if ($paginator->hasPages())
<nav class="pagination-wrap" role="navigation" aria-label="Navigasi halaman">
    <div class="cctv-pagination">
        <p class="pagination-summary">
            Menampilkan <strong>{{ $paginator->firstItem() }}</strong>–<strong>{{ $paginator->lastItem() }}</strong>
            dari <strong>{{ $paginator->total() }}</strong>
        </p>
        <div class="pagination-controls">
            @if ($paginator->onFirstPage())
                <span class="pagination-btn disabled" aria-disabled="true">Sebelumnya</span>
            @else
                <a class="pagination-btn" href="{{ $paginator->previousPageUrl() }}" rel="prev">Sebelumnya</a>
            @endif
            <div class="pagination-numbers">
                @foreach ($elements as $element)
                    @if (is_string($element))
                        <span class="pagination-ellipsis">{{ $element }}</span>
                    @endif
                    @if (is_array($element))
                        @foreach ($element as $page => $url)
                            @if ($page == $paginator->currentPage())
                                <span class="pagination-btn active" aria-current="page">{{ $page }}</span>
                            @else
                                <a class="pagination-btn" href="{{ $url }}">{{ $page }}</a>
                            @endif
                        @endforeach
                    @endif
                @endforeach
            </div>
            @if ($paginator->hasMorePages())
                <a class="pagination-btn" href="{{ $paginator->nextPageUrl() }}" rel="next">Berikutnya</a>
            @else
                <span class="pagination-btn disabled" aria-disabled="true">Berikutnya</span>
            @endif
        </div>
    </div>
</nav>
@endif
