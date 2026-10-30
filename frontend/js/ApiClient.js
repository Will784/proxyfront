(function (global) {
  'use strict';

  class ApiRequestError extends Error {
    constructor(status, body) {
      super((body && body.message) || 'No se pudo completar la petición.');
      this.status = status;
      this.code = body && body.code;
    }
  }

  /** Only talks to the backend REST API; the browser never reaches the database. */
  class ApiClient {
    constructor(baseUrl, identity) {
      this.baseUrl = baseUrl;
      this.identity = identity;
    }

    async request(path, options = {}) {
      let response;
      try {
        response = await fetch(this.baseUrl + path, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            'X-Role': this.identity.role,
            'X-Client-Id': this.identity.clientId
          }
        });
      } catch (networkError) {
        throw new ApiRequestError(0, { message: 'No hay conexión con el backend. Revisa la URL en AppConfig.js.' });
      }
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      if (!response.ok) {
        throw new ApiRequestError(response.status, body);
      }
      return body;
    }

    overview() { return this.request('/api/v1/proxies'); }
    audit(limit = 12) { return this.request('/api/v1/proxies/audit?limit=' + limit); }
    recent(domain, limit = 10) { return this.request('/api/v1/logs/' + domain + '?limit=' + limit); }
    stats(domain) { return this.request('/api/v1/logs/' + domain + '/stats'); }
    detail(domain, id) { return this.request('/api/v1/logs/' + domain + '/' + id); }
    send(domain, body) { return this.request('/api/v1/logs/' + domain, { method: 'POST', body: JSON.stringify(body) }); }
  }

  global.LogHub = Object.assign(global.LogHub || {}, { ApiClient, ApiRequestError });
})(window);
