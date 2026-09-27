import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', title: 'Battlestation', loadComponent: () => import('./bridge/bridge-page').then((m) => m.BridgePage) },
  { path: '**', redirectTo: '' },
];
