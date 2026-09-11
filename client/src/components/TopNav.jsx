import { Link, useLocation } from 'react-router-dom';
import { Upload, History, Waves } from 'lucide-react';
import { clsx } from 'clsx';

const TopNav = () => {
  const location = useLocation();

  const navLink = (to, label, Icon, exact = false) => {
    const isActive = exact
      ? location.pathname === to
      : location.pathname === to || location.pathname.startsWith(to + '/');
    return (
      <Link
        to={to}
        className={clsx(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-200 text-xs font-semibold tracking-wide uppercase min-h-[36px] active:scale-95',
          isActive
            ? 'bg-white/15 text-white border border-sky-400/30 shadow-xs'
            : 'text-sky-300/80 hover:bg-white/8 hover:text-white border border-transparent'
        )}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </Link>
    );
  };

  return (
    <header
      className="w-full bg-ocean-950 text-white flex items-center justify-between h-13 px-4 sm:px-6 shrink-0 z-20 border-b border-white/[0.06] select-none"
      style={{ height: '52px' }}
    >
      {/* Left — Brand & Nav */}
      <div className="flex items-center gap-4 sm:gap-8 min-w-0">
        <Link to="/history" className="flex items-center gap-2 group shrink-0 active:scale-95 transition-transform">
          <div className="bg-gradient-to-br from-sky-400 to-indigo-600 p-1.5 rounded-lg shadow-lg group-hover:scale-105 transition-transform">
            <Waves className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-sm sm:text-base tracking-tight text-white">
            Uni<span className="text-sky-400">Routine</span>
          </span>
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {navLink('/history', 'History', History)}
          {navLink('/upload', 'Upload Routine', Upload)}
        </nav>
      </div>

      {/* Right — Quick Status */}
      <div className="flex items-center gap-2 text-xs text-sky-300/70 font-medium">
        <span className="hidden sm:inline-block">Class Routine Generator</span>
      </div>
    </header>
  );
};

export default TopNav;
