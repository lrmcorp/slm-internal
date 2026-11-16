<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>@yield('title', 'Dashboard') · CCTV SLM</title>
    
    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    
    <link rel="stylesheet" href="{{ asset('css/dashboard.css') }}?v=2">
    <script src="{{ asset('js/dashboard.js') }}?v=2" defer></script>
    @stack('head')
</head>
<body>
@auth
@php
    $section = request()->is('reports') ? 'reports' : (request()->is('cameras/*') ? 'cameras' : (request()->is('labels/*') ? 'labels' : (request()->is('incidents/*') ? 'incidents' : request('section', 'overview'))));
    $menu = [
        'overview'  => ['Ringkasan', 'grid'],
        'cameras'   => ['Kamera', 'camera'],
        'labels'    => ['Label & invoice', 'label'],
        'incidents' => ['Kejadian', 'alert'],
        'reports'   => ['Laporan orang', 'report'],
        'settings'  => ['Pengaturan', 'settings']
    ];
@endphp

<button class="sidebar-backdrop" aria-label="Tutup navigasi" tabindex="-1" hidden></button>

<aside class="sidebar" id="sidebar" aria-label="Navigasi utama">
    <a class="brand" href="{{ route('dashboard') }}">
        <span class="brand-mark">@include('partials.icon', ['name' => 'camera'])</span>
        <span>CCTV<span class="brand-light"> SLM</span><small>Aneka Jaya</small></span>
    </a>
    <p class="nav-caption">PEMANTAUAN TOKO</p>
    <nav>
        @foreach($menu as $key => [$text, $icon])
            <a class="nav-link {{ $section === $key ? 'active' : '' }}" 
               @if($section === $key) aria-current="page" @endif 
               href="{{ $key === 'reports' ? route('dashboard.reports') : route('dashboard', ['section' => $key]) }}">
                @include('partials.icon', ['name' => $icon])
                <span>{{ $text }}</span>
                @if($section === $key)<span class="nav-dot"></span>@endif
            </a>
        @endforeach
    </nav>
    <div class="sidebar-foot">
        <span class="badge">ERP SLM</span>
        <p>Catatan kamera, bukti,<br>dan pemeriksaan dalam satu tempat.</p>
        <small class="text-muted">Waktu ditampilkan dalam WIB</small>
    </div>
</aside>

<div class="app-shell">
    <header class="topbar">
        <div class="topbar-left">
            <button class="icon-button" id="sidebar-toggle" aria-controls="sidebar" aria-expanded="false" aria-label="Buka navigasi">
                @include('partials.icon', ['name' => 'menu'])
            </button>
            <span class="header-context">Pemantauan CCTV <span>/</span> {{ $menu[$section][0] ?? 'Dashboard' }}</span>
        </div>
        <div class="topbar-right">
            @php
                $erpHealth = \App\Http\Controllers\DashboardController::checkErpHealth();
                $healthClass = match($erpHealth['status'] ?? 'unconfigured') {
                    'connected' => 'good',
                    'degraded' => 'warn',
                    'disconnected' => 'bad',
                    default => '',
                };
            @endphp
            <div id="erp-health-pill" class="badge erp-health-pill {{ $healthClass }}" title="{{ $erpHealth['message'] ?? 'Status koneksi ERP SLM' }}">
                <span class="pulse-dot"></span>
                <span id="erp-health-label">ERP SLM: {{ $erpHealth['label'] ?? 'Memeriksa...' }}</span>
            </div>
            <span class="header-date">{{ now()->timezone('Asia/Jakarta')->translatedFormat('d M Y') }}</span>
            <button class="icon-button" id="theme-toggle" aria-label="Ganti tema" aria-pressed="false">
                @include('partials.icon', ['name' => 'moon'])
            </button>
            <details class="user-menu">
                <summary>
                    <span class="avatar">{{ mb_strtoupper(mb_substr(auth()->user()->name, 0, 1)) }}</span>
                    <span class="user-name">
                        {{ auth()->user()->name }}
                        <small>{{ auth()->user()->is_admin ? 'Administrator' : 'Pemeriksa' }}</small>
                    </span>
                    <span aria-hidden="true">⌄</span>
                </summary>
                <div class="user-dropdown">
                    <small class="text-muted">{{ auth()->user()->email }}</small>
                    <form method="post" action="{{ route('logout') }}">
                        @csrf
                        <button class="secondary" type="submit">Keluar dari akun</button>
                    </form>
                </div>
            </details>
        </div>
    </header>

    <main class="main-content">
        @if($errors->any())
            <div class="notice error" role="alert">{{ $errors->first() }}</div>
        @endif
        @if(session('status'))
            <div class="notice success" role="status">{{ session('status') }}</div>
        @endif
        @yield('content')
    </main>
    
    <footer class="page-footer">
        CCTV SLM <span>·</span> Aneka Jaya <span>·</span> Pemeriksaan berdasarkan bukti
    </footer>
</div>
@else
<div class="auth-shell">
    @if($errors->any())
        <div class="notice error" role="alert">{{ $errors->first() }}</div>
    @endif
    @yield('content')
</div>
@endauth

@stack('scripts')
</body>
</html>
