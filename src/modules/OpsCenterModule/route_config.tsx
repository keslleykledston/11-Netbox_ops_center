/**
 * Arquivo de Configuração de Rotas para o Módulo Ops Center
 *
 * O usuário deve integrar este trecho de código no arquivo de rotas principal
 * do projeto (ex: src/router/index.tsx ou App.tsx)
 */

import React, { lazy } from 'react';
import { RouteObject } from 'react-router-dom'; // Assumindo react-router-dom

// Importação do componente principal do novo módulo
// O caminho deve ser ajustado conforme a estrutura final do projeto
const OpsCenterModule = lazy(() => import('../src/modules/OpsCenterModule/OpsCenterModule'));

export const opsCenterRoutes: RouteObject[] = [
  {
    path: '/ops-center',
    element: <OpsCenterModule />,
    children: [
      // Rotas filhas podem ser adicionadas aqui se necessário (ex: /ops-center/lg, /ops-center/irr)
      // Mas o componente principal já gerencia a navegação interna via Tabs.
    ],
    handle: {
      // Metadados para o breadcrumb ou título da página
      title: 'NetBox Ops Center',
      crumb: () => 'Ops Center',
    },
  },
];

// Exemplo de como o usuário pode integrar no arquivo principal de rotas:
/*
// Exemplo de arquivo principal de rotas (App.tsx ou router.tsx)
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { mainRoutes } from './mainRoutes';
import { opsCenterRoutes } from './opsCenterRoutes'; // Importar o novo arquivo

const router = createBrowserRouter([
  ...mainRoutes,
  ...opsCenterRoutes, // Adicionar as novas rotas
  // ... outras rotas
]);

const App = () => {
  return <RouterProvider router={router} />;
};
*/
