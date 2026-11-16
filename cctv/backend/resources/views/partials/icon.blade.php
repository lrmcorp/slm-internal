<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
@switch($name ?? 'grid')
@case('camera')<path d="m16 9 5-3v12l-5-3"/><rect x="3" y="6" width="13" height="12" rx="3"/>@break
@case('label')<path d="M20 13 11 22 2 13V3h10l8 8a1.4 1.4 0 0 1 0 2Z"/><circle cx="7" cy="8" r="1"/>@break
@case('alert')<path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/>@break
@case('report')<path d="M5 21V3h10l4 4v14Z"/><path d="M14 3v5h5M9 12h6m-6 4h6"/>@break
@case('settings')<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>@break
@case('menu')<path d="M4 6h16M4 12h16M4 18h16"/>@break
@case('moon')<path d="M20 15.2A8 8 0 0 1 8.8 4 8 8 0 1 0 20 15.2Z"/>@break
@case('arrow')<path d="M5 12h14m-5-5 5 5-5 5"/>@break
@default<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>
@endswitch
</svg>
