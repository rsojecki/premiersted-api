const jwt = require('jsonwebtoken');
const config = require('../config')();

const { users, level } = require('../services');

const getToken = ({ user }) =>
  jwt.sign(user, config.get('JWT_SECRET'), {
    issuer: 'Premiersted', expiresIn: '7 days',
  });
const template = token => `
  <html>
    <head>
      <title>JWT Token</title>
      <script>
        window.addEventListener('message', (event) => {
          if (event.data == 'ready?') {
            event.source.postMessage({jwt: '${token}'},'*');
            window.close();
          }
        });
      </script>
    </head>
  </html>
`;
const auth = ({ user }, res) => {
  if (user) {
    res.send(template(getToken({ user })));
  }
};

const propagateAuthIssue = msg => (reqOrWs, res, code = 401) => {
  if (reqOrWs.upgrade) {
    if (!reqOrWs.closing) {
      reqOrWs.ws.send(msg);
      process.nextTick(() => reqOrWs.ws.close());
    }
    reqOrWs.closing = true; // eslint-disable-line
    return;
  }
  res.status(code).send(msg);
};

const decodeJWT = (req, res, next) => {
  const token = req.headers['auth-token'];
  if (!req.user && token) {
    jwt.verify(token, config.get('JWT_SECRET'), {}, (err, decoded) => {
      if (err) {
        propagateAuthIssue(`Unauthorized: ${err.message}`)(req, res);
      }
      req.user = decoded;
    });
  }
  next();
};

const protect = (req, res, next) => {
  decodeJWT(req, res, () => {});
  if (req.user) {
    next();
  } else {
    propagateAuthIssue('Unauthorized: no token provided')(req, res);
  }
};

const protectLevel = requestedLevel => (req, res, next) => {
  protect(req, res, () => {
    users.getAccess(req.user)
      .then((userLevel) => {
        if (level.atLeast(userLevel, requestedLevel)) {
          next();
        } else {
          propagateAuthIssue(`Forbidden: insufficient permissions ${userLevel}, needs ${requestedLevel}`)(req, res, 403);
        }
      })
      .catch((e) => {
        console.error(e);
        propagateAuthIssue('Internal Server Error')(req, res, 403);
      });
  });
};
module.exports = {
  auth, protect, protectLevel, getToken, decodeJWT,
};
