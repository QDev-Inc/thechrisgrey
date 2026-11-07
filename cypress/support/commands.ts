// ***********************************************
// Custom Cypress Commands
//
// For comprehensive examples visit:
// https://on.cypress.io/custom-commands
// ***********************************************

import { BACKEND_POST_URL } from './endpoints';

// The import above makes this file a module, so the Cypress augmentation has to
// be reopened inside `declare global` — a bare `declare namespace Cypress` would
// become module-local and silently stop typing the custom commands.
declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Verify that the main navigation bar is visible on the page.
       */
      verifyNavigation(): Chainable<void>;

      /**
       * Verify that the footer is visible on the page.
       */
      verifyFooter(): Chainable<void>;

      /**
       * Verify SEO meta tags exist on the page.
       * @param title - Expected title text (partial match)
       * @param description - Whether to check that meta description exists
       */
      verifySEO(title: string, description?: boolean): Chainable<void>;

      /**
       * Stub the Sanity API to return fixture data for blog listing.
       */
      stubSanityBlogListing(): Chainable<void>;

      /**
       * Stub the Sanity API to return fixture data for a single blog post.
       */
      stubSanityBlogPost(): Chainable<void>;

      /**
       * Stub the chat streaming endpoint with a mock response.
       */
      stubChatEndpoint(): Chainable<void>;

      /**
       * Stub the contact form endpoint.
       */
      stubContactEndpoint(): Chainable<void>;
    }
  }
}

// -- Navigation Verification --
Cypress.Commands.add('verifyNavigation', () => {
  // Target the primary site nav explicitly. Pages now render up to three <nav>
  // landmarks — the header nav, the breadcrumb trail, and the "Explore more"
  // cross-link band — so a bare cy.get('nav') resolves to multiple elements and
  // .within() throws. data-vt-persist="navigation" is unique to the header nav.
  cy.get('nav[data-vt-persist="navigation"]').should('be.visible');
  cy.get('nav[data-vt-persist="navigation"]').within(() => {
    cy.get('a').contains('Home').should('exist');
  });
});

// -- Footer Verification --
Cypress.Commands.add('verifyFooter', () => {
  cy.get('footer').should('exist');
  cy.get('footer').within(() => {
    cy.contains('Christian Perez').should('exist');
    cy.contains('Privacy Policy').should('exist');
  });
});

// -- SEO Verification --
Cypress.Commands.add('verifySEO', (title: string, description = true) => {
  cy.title().should('contain', title);
  if (description) {
    cy.get('head meta[name="description"]').should('have.attr', 'content').and('not.be.empty');
  }
});

// -- Stub Sanity Blog Listing --
Cypress.Commands.add('stubSanityBlogListing', () => {
  cy.intercept('GET', '**/k5950b3w**sanity.io/**', (req) => {
    // Only intercept blog listing queries
    if (req.url.includes('_type+%3D%3D+%22post%22') || req.url.includes('_type%20%3D%3D%20%22post%22')) {
      req.reply({
        statusCode: 200,
        body: { result: null },
        headers: { 'content-type': 'application/json' },
      });
    }
  });

  // Use a more reliable intercept for the combined query
  cy.intercept('**/k5950b3w**sanity.io/**', (req) => {
    req.reply((res) => {
      // Let it through but we set up fixtures as fallback
      if (res) {
        res.send();
      }
    });
  });
});

// -- Stub Sanity Blog Post --
Cypress.Commands.add('stubSanityBlogPost', () => {
  cy.fixture('blog-post-detail.json').then((postDetail) => {
    cy.intercept('GET', '**/k5950b3w**sanity.io/**', {
      statusCode: 200,
      body: { result: postDetail },
    }).as('sanityPostDetail');
  });
});

// -- Stub Chat Endpoint --
Cypress.Commands.add('stubChatEndpoint', () => {
  // Matches the chat Function URL in local/prod builds and the CI placeholder
  // endpoint alike — see BACKEND_POST_URL.
  cy.intercept('POST', BACKEND_POST_URL, {
    statusCode: 200,
    headers: { 'content-type': 'text/plain' },
    body: 'Christian Perez is the Founder and CEO of Altivum Inc., a veteran-founded technology firm. He served as a Green Beret (18D) in the U.S. Army Special Forces.',
  }).as('chatResponse');
});

// -- Stub Contact Endpoint --
Cypress.Commands.add('stubContactEndpoint', () => {
  // Matches the contact Function URL in local/prod builds and the CI placeholder
  // endpoint alike — see BACKEND_POST_URL.
  cy.intercept('POST', BACKEND_POST_URL, (request) => {
    // Metrics posts share the CI placeholder URL; alias only contact payloads.
    if (typeof request.body?.email === 'string' && typeof request.body?.message === 'string') {
      request.alias = 'contactSubmit';
    }
    request.reply({
      statusCode: 200,
      body: { message: 'Message sent successfully' },
    });
  });
});
