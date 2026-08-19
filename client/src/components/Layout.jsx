import { Outlet } from 'react-router-dom';
import TopNav from './TopNav';

const Layout = () => {
  return (
    <div className="flex flex-col h-dvh w-full bg-transparent overflow-hidden">
      <TopNav />
      <main className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-6 lg:px-8 py-4 sm:py-6 pb-safe relative">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
