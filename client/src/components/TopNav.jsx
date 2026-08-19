import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Upload, History, Waves, LayoutGrid, LogIn, LogOut, User } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

const TopNav = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const navLink = (to, label, Icon, exact = false) => {
    const isActive = exact
      ? location.pathname === to
      : location.pathname === to || (to !== '/' && location.pathname.startsWith(to + '/'));
    return (
      <Link
        to={to}
        className={clsx(
          'flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg transition-all duration-200 text-[11px] sm:text-xs font-semibold tracking-tight sm:tracking-wide uppercase min-h-[36px] active:scale-95',
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

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
    navigate('/');
  };

  return (
    <header className="w-full bg-ocean-950 text-white flex items-center justify-between h-13 px-2.5 sm:px-6 shrink-0 z-20 border-b border-white/[0.06] select-none"
      style={{ height: '52px' }}
    >
      {/* Left — Brand & Nav */}
      <div className="flex items-center gap-2 sm:gap-6 min-w-0">
        <Link to="/" className="flex items-center gap-1.5 sm:gap-2 group shrink-0 active:scale-95 transition-transform">
          <div className="bg-gradient-to-br from-sky-400 to-indigo-600 p-1.5 rounded-lg shadow-lg group-hover:scale-105 transition-transform">
            <Waves className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-sm sm:text-base tracking-tight text-white">
            Uni<span className="text-sky-400">Routine</span>
          </span>
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
          {navLink('/', 'Routines', LayoutGrid, true)}
          {user && navLink('/upload', 'Upload', Upload)}
          {user && navLink('/history', 'History', History)}
        </nav>
      </div>

      {/* Right — Auth */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {user ? (
          <>
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg">
              <User className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-medium text-slate-300 max-w-[140px] truncate">{user.email}</span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold uppercase tracking-wide text-rose-300 hover:bg-rose-500/10 active:bg-rose-500/20 border border-transparent hover:border-rose-400/20 transition-all min-h-[36px]"
              title="Logout"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </>
        ) : (
          <Link
            to="/login"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-white rounded-lg text-xs font-bold uppercase tracking-wide transition-all shadow-md shadow-sky-900/30 min-h-[36px]"
          >
            <LogIn className="w-3.5 h-3.5 shrink-0" />
            <span>Login</span>
          </Link>
        )}
      </div>
    </header>
  );
};

export default TopNav;
