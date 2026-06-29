import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Calendar, Shield, User, LogOut, LogIn, Waves } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

const TopNav = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAdmin, user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
    navigate('/');
  };

  const navLink = (to, label, Icon, exact = false) => {
    const isActive = exact
      ? location.pathname === to
      : location.pathname === to || location.pathname.startsWith(to + '/');
    return (
      <Link
        to={to}
        className={clsx(
          'flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 text-sm font-medium',
          isActive
            ? 'bg-white/15 text-white border border-sky-400/30 shadow-[0_0_12px_rgba(56,189,248,0.2)]'
            : 'text-sky-200 hover:bg-white/10 hover:text-white border border-transparent'
        )}
      >
        <Icon className="w-4 h-4" />
        <span>{label}</span>
      </Link>
    );
  };

  return (
    <div className="w-full bg-linear-to-r from-ocean-950 via-ocean-900 to-ocean-950 text-white flex items-center justify-between h-16 px-6 shadow-2xl shrink-0 z-10 border-b border-sky-500/20">

      {/* Left — Brand + Nav */}
      <div className="flex items-center gap-8">
        <Link to="/" className="flex items-center gap-3 group">
          <div className="bg-linear-to-br from-sky-400 to-ocean-600 p-2 rounded-xl shadow-lg shadow-sky-900/40 group-hover:scale-105 transition-transform">
            <Waves className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight bg-clip-text text-transparent bg-linear-to-r from-sky-200 to-white">
            UniRoutine
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {navLink('/', 'Home', Calendar, true)}
          {isAdmin && navLink('/admin', 'Admin Panel', Shield)}
        </nav>
      </div>

      {/* Right — Auth */}
      <div className="flex items-center gap-3">
        {isAdmin ? (
          <>
            <div className="hidden sm:flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full border border-sky-500/20">
              <div className="bg-sky-500/20 p-1.5 rounded-full">
                <User className="w-3.5 h-3.5 text-sky-300" />
              </div>
              <div className="text-left">
                <p className="text-xs font-semibold text-white leading-tight">{user?.email}</p>
                <p className="text-[9px] text-sky-400 leading-tight tracking-widest uppercase">Administrator</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-red-300 hover:text-white hover:bg-red-500/20 border border-transparent hover:border-red-400/30 transition-all"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </>
        ) : (
          <Link
            to="/login"
            className="flex items-center gap-2 px-4 py-2 bg-sky-500/20 hover:bg-sky-500/30 text-sky-100 font-medium rounded-lg border border-sky-400/30 transition-all text-sm hover:shadow-[0_0_12px_rgba(56,189,248,0.2)]"
          >
            <LogIn className="w-4 h-4" />
            <span>Admin Login</span>
          </Link>
        )}
      </div>
    </div>
  );
};

export default TopNav;
