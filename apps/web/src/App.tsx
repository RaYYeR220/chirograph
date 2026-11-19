import { Route, Switch } from 'wouter';
import { Landing } from './pages/Landing';
import { Swap } from './pages/Swap';
import { Explorer } from './pages/Explorer';
import { Pay } from './pages/Pay';
import { Merchants } from './pages/Merchants';
import { Protocol } from './pages/Protocol';
import { Dev } from './pages/Dev';
import { Page } from './components/Shell';

export function App() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/swap">{() => <Swap />}</Route>
      <Route path="/swap/:id">{(p) => <Swap key={p.id} id={p.id} />}</Route>
      <Route path="/explorer" component={Explorer} />
      <Route path="/pay" component={Pay} />
      <Route path="/merchants" component={Merchants} />
      <Route path="/protocol" component={Protocol} />
      {import.meta.env.DEV ? <Route path="/dev" component={Dev} /> : null}
      <Route>{() => <Page><div className="page-h"><h1>Not here.</h1><p>That page does not exist.</p></div></Page>}</Route>
    </Switch>
  );
}
