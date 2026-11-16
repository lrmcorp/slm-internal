(() => {
 const toggle=document.getElementById('sidebar-toggle'),backdrop=document.querySelector('.sidebar-backdrop');
 function close(){document.body.classList.remove('nav-open');toggle?.setAttribute('aria-expanded','false');if(backdrop)backdrop.hidden=true;}
 toggle?.addEventListener('click',()=>{const open=document.body.classList.toggle('nav-open');toggle.setAttribute('aria-expanded',String(open));if(backdrop)backdrop.hidden=!open;});
 backdrop?.addEventListener('click',close);
 document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
 const theme=document.getElementById('theme-toggle');
 function apply(dark){document.documentElement.classList.toggle('dark',dark);theme?.setAttribute('aria-pressed',String(dark));}
 try{apply(localStorage.getItem('cctv-theme')==='dark');}catch(e){}
 theme?.addEventListener('click',()=>{const dark=!document.documentElement.classList.contains('dark');apply(dark);try{localStorage.setItem('cctv-theme',dark?'dark':'light');}catch(e){}});
 document.querySelectorAll('[data-password-toggle]').forEach(button=>button.addEventListener('click',()=>{const input=document.getElementById(button.dataset.passwordToggle);const visible=input.type==='password';input.type=visible?'text':'password';button.textContent=visible?'Sembunyikan':'Tampilkan';button.setAttribute('aria-pressed',String(visible));}));
})();
