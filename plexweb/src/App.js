import axios from 'axios';
import React from "react";
import { BrowserRouter as Router, Route, Switch } from "react-router-dom";
import SideNav from "./components/sidenav";
import "./App.css";
import Library from "./components/libraryview";
import Player from "./components/player";
import Lobby from "./components/lobbyview";
import LoginView from "./components/loginview";
import * as model from "./model/model";

const playerPage = (props) => {
  const mediaid = props.match.params.mediaid;
  return <Player mediaid={mediaid} />
}

const lobbyPage = (props) => {
  const lobbyid = props.match.params.lobbyid;
  return <Lobby lobbyid={lobbyid} />
}

class App extends React.Component {
  state = {
    user: null
  }

  constructor(props) {
    super(props);
    this.login();
  }

  async login() {
    const copy = Object.assign({}, this.state);
    copy.user = await model.user.getCurrentUserInfo();
    this.setState(copy);
  }

  render() {
    const content = [];
    for (let x = 0; x < 1000; ++x) {
      content.push(<p>TEST</p>);
    }

    if (!this.state.user) {
      return (
        <div className="absolute-center-content">
          <LoginView />
        </div>
      );
    }
    
    return (
      <Router basename="/web">
        <Switch> {/* iterates its children and takes the first that matches */}
          {/* <Route path={`/player/:mediaid`} component={playerPage} /> */}
          <Route path={`/lobby/:lobbyid`} component={lobbyPage} />
          <Route path={`/`}>
            <div className="App">
              <div className="sidenav-container">
                <SideNav />
              </div>

              <div className="content-container">
                <Route path={`/library/:libraryid`} component={Library} />
              </div>
            </div>
          </Route>
        </Switch>
      </Router>
    );
  }
}

export default App;