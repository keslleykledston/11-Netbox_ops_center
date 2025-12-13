/**
 * Trecho de Código para Adicionar Link de Navegação
 *
 * O usuário deve integrar este trecho no componente de navegação principal
 * do projeto (ex: src/components/Sidebar.tsx ou Header.tsx)
 */

import { Link } from 'react-router-dom'; // Assumindo react-router-dom
import { Wrench } from 'lucide-react'; // Ícone de ferramenta

// Componente de Link de Navegação para o Módulo Ops Center
export const OpsCenterNavLink: React.FC = () => {
  return (
    <Link
      to="/ops-center"
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-gray-900 transition-all hover:text-primary dark:text-gray-400 dark:hover:text-gray-50"
      // Adicionar a classe 'active' se a rota atual for '/ops-center' ou sub-rotas
      // className={({ isActive }) => isActive ? "..." : "..."} // Se estiver usando NavLink
    >
      <Wrench className="h-4 w-4" />
      NetBox Ops Center
    </Link>
  );
};

// Exemplo de como o usuário pode integrar no componente de Sidebar:
/*
// Exemplo de arquivo principal de Sidebar (Sidebar.tsx)
import { OpsCenterNavLink } from '../../integration_files/navigation_link'; // Ajustar o caminho

const Sidebar = () => {
  return (
    <nav className="flex flex-col gap-1">
      // ... outros links de navegação
      <OpsCenterNavLink /> // Adicionar o novo link
      // ...
    </nav>
  );
};
*/
