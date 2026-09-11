import { Link, useLocation } from 'react-router-dom';
import { Upload, History, Waves, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../contexts/AuthContext';

const TopNav = () => {
  const location = useLocation();
  const { user, logout } = useAuth();

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

      {/* Right — Auth & Status */}
      <div className="flex items-center gap-3 text-xs">
        <span className="hidden md:inline-block text-sky-300/60 font-medium mr-1">Class Routine Generator</span>
        {user ? (
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-400/20 text-sky-300">
              <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
              <span className="font-medium text-xs max-w-36 truncate">{user.email || 'Admin'}</span>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors text-xs font-medium"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        ) : (
          <Link
            to="/login"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 hover:text-white border border-sky-400/30 text-xs font-semibold tracking-wide transition-all active:scale-95"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </Link>
        )}
      </div>
    </header>
  );
};

export default TopNav;
