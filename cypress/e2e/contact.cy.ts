import { BACKEND_POST_URL } from '../support/endpoints';

const TURNSTILE_TOKEN = 'contact-test-turnstile-token';

function visitContact() {
  cy.visit('/contact', {
    onBeforeLoad(win) {
      let onToken: ((token: string) => void) | undefined;
      Object.defineProperty(win, 'turnstile', {
        value: {
          render(_container: HTMLElement, options: { callback?: (token: string) => void }) {
            onToken = options.callback;
            return 'contact-test-widget';
          },
          execute() {
            onToken?.(TURNSTILE_TOKEN);
          },
          remove() {
            onToken = undefined;
          },
        },
      });
    },
  });
}

describe('Contact Page', () => {
  beforeEach(() => {
    visitContact();
  });

  it('should load the contact page successfully', () => {
    cy.url().should('include', '/contact');
  });

  it('should display the page heading', () => {
    cy.contains('h1', "Let's Connect").should('be.visible');
  });

  it('should have correct SEO meta tags', () => {
    cy.verifySEO('Contact');
  });

  it('should display the Speaking & Media section', () => {
    cy.contains('h2', 'Speaking & Media').should('be.visible');
  });

  it('should display speaking topics', () => {
    cy.contains('Cloud & AI Strategy').should('be.visible');
    cy.contains('Veteran Transition').should('be.visible');
    cy.contains('Entrepreneurship').should('be.visible');
    cy.contains('Leadership').should('be.visible');
  });

  it('should display event types', () => {
    cy.contains('Event Types').should('be.visible');
    cy.contains('Keynote presentations').should('be.visible');
    cy.contains('Panel discussions').should('be.visible');
    cy.contains('Podcast guest appearances').should('be.visible');
    cy.contains('Corporate workshops').should('be.visible');
    cy.contains('Media interviews').should('be.visible');
    cy.contains('Veteran organization events').should('be.visible');
  });

  it('should have a Download Press Kit link', () => {
    cy.contains('Download Press Kit').should('have.attr', 'href', '/press-kit.zip').and('have.attr', 'download');
  });

  it('should display the contact form with all fields', () => {
    cy.contains('h2', 'Send a Message').should('be.visible');

    cy.get('input#name').should('be.visible');
    cy.get('input#email').should('be.visible');
    cy.get('input#subject').should('be.visible');
    cy.get('textarea#message').should('be.visible');
    cy.get('button[type="submit"]').should('be.visible');
  });

  it('should have correct form field labels', () => {
    cy.get('label[for="name"]').should('contain.text', 'Name');
    cy.get('label[for="email"]').should('contain.text', 'Email');
    cy.get('label[for="subject"]').should('contain.text', 'Subject');
    cy.get('label[for="message"]').should('contain.text', 'Message');
  });

  it('should show validation error for too-short name', () => {
    cy.stubContactEndpoint();

    cy.get('input#name').type('A');
    cy.get('input#email').type('test@example.com');
    cy.get('textarea#message').type('This is a test message with enough characters.');
    cy.get('button[type="submit"]').click();

    cy.contains('Name must be between 2 and 100 characters').should('be.visible');
  });

  it('should show validation error for invalid email', () => {
    cy.stubContactEndpoint();

    cy.get('input#name').type('John Doe');
    // Use an email that passes browser HTML5 validation (has @) but fails
    // the app's stricter isValidEmail regex (missing TLD)
    cy.get('input#email').type('user@invalid');
    cy.get('textarea#message').type('This is a test message with enough characters.');
    cy.get('button[type="submit"]').click();

    cy.contains('Please enter a valid email address').should('be.visible');
  });

  it('should show validation error for too-short message', () => {
    cy.stubContactEndpoint();

    cy.get('input#name').type('John Doe');
    cy.get('input#email').type('john@example.com');
    cy.get('textarea#message').type('Short');
    cy.get('button[type="submit"]').click();

    cy.contains('Message must be between 10 and 5000 characters').should('be.visible');
  });

  it('should clear the error when the user starts typing after an error', () => {
    cy.stubContactEndpoint();

    // Trigger a validation error
    cy.get('input#name').type('A');
    cy.get('input#email').type('test@example.com');
    cy.get('textarea#message').type('This is a test message with enough characters.');
    cy.get('button[type="submit"]').click();

    cy.get('[role="alert"]').should('be.visible');

    // Start typing again to clear the error
    cy.get('input#name').clear().type('Valid Name');
    cy.get('[role="alert"]').should('not.exist');
  });

  it('should submit the form successfully and show the success modal', () => {
    cy.stubContactEndpoint();

    cy.get('input#name').type('John Doe');
    cy.get('input#email').type('john@example.com');
    cy.get('input#subject').type('Speaking Inquiry');
    cy.get('textarea#message').type(
      'I would like to invite you to speak at our upcoming tech conference. It would be a great fit for your expertise.',
    );
    cy.get('button[type="submit"]').click();

    cy.wait('@contactSubmit').its('request.body.turnstileToken').should('eq', TURNSTILE_TOKEN);

    // Success modal should appear
    cy.get('[role="dialog"]').should('be.visible');
    cy.contains('Thank You!').should('be.visible');
    cy.contains('Thanks for contacting me').should('be.visible');
  });

  it('should close the success modal when clicking the Close button', () => {
    cy.stubContactEndpoint();

    cy.get('input#name').type('John Doe');
    cy.get('input#email').type('john@example.com');
    cy.get('textarea#message').type('I would like to invite you to speak at our upcoming conference.');
    cy.get('button[type="submit"]').click();

    cy.get('[role="dialog"]').should('be.visible');
    cy.get('[role="dialog"]').contains('Close').click();
    cy.get('[role="dialog"]').should('not.exist');
  });

  it('should clear the form after successful submission', () => {
    cy.stubContactEndpoint();

    cy.get('input#name').type('John Doe');
    cy.get('input#email').type('john@example.com');
    cy.get('textarea#message').type('I would like to invite you to speak at our upcoming conference.');
    cy.get('button[type="submit"]').click();

    // Close the success modal
    cy.get('[role="dialog"]').contains('Close').click();

    // Form should be empty
    cy.get('input#name').should('have.value', '');
    cy.get('input#email').should('have.value', '');
    cy.get('input#subject').should('have.value', '');
    cy.get('textarea#message').should('have.value', '');
  });

  it('should display contact information cards', () => {
    cy.contains('Other Ways to Connect').should('be.visible');
    cy.contains('Phone').should('be.visible');
    cy.contains('(615) 219-9425').should('be.visible');
    cy.contains('General Inquiries').should('be.visible');
    cy.contains('info@altivum.ai').should('be.visible');
    cy.contains('Direct Email').should('be.visible');
    cy.contains('christian.perez@altivum.ai').should('be.visible');
  });

  it('should display availability section', () => {
    cy.contains('Availability').should('be.visible');
    cy.contains('Virtual consultations available').should('be.visible');
    cy.contains('Speaking engagements').should('be.visible');
    cy.contains('Podcast guest appearances').should('be.visible');
    cy.contains('Strategic consulting').should('be.visible');
  });

  it('should have external links with proper attributes', () => {
    cy.get('a[href*="linkedin.com"]')
      .should('have.attr', 'target', '_blank')
      .and('have.attr', 'rel')
      .and('include', 'noopener');

    cy.get('a[href*="github.com"]')
      .should('have.attr', 'target', '_blank')
      .and('have.attr', 'rel')
      .and('include', 'noopener');
  });

  it('should display the navigation bar', () => {
    cy.verifyNavigation();
  });

  it('should display the footer', () => {
    cy.verifyFooter();
  });

  it('should be responsive on mobile viewport', () => {
    cy.viewport('iphone-x');
    cy.contains('h1', "Let's Connect").should('be.visible');
    cy.get('input#name').should('be.visible');
    cy.get('button[type="submit"]').should('be.visible');
  });

  it('should show the submit button as disabled while submitting', () => {
    // Intercept with a delay to observe the loading state
    cy.intercept('POST', BACKEND_POST_URL, {
      statusCode: 200,
      body: { message: 'Message sent successfully' },
      delay: 2000,
    }).as('slowSubmit');

    cy.get('input#name').type('John Doe');
    cy.get('input#email').type('john@example.com');
    cy.get('textarea#message').type('This is a test message for the contact form submission.');
    cy.get('button[type="submit"]').click();

    cy.get('button[type="submit"]').should('be.disabled');
    cy.contains('Sending...').should('be.visible');
  });
});

describe('Contact Page - Network Error', () => {
  it('should show an error message when the network request fails', () => {
    visitContact();

    // Set up the network error intercept after the page loads
    cy.intercept('POST', BACKEND_POST_URL, {
      forceNetworkError: true,
    }).as('networkError');

    cy.get('input#name').type('John Doe');
    cy.get('input#email').type('john@example.com');
    cy.get('textarea#message').type('This is a test message for the contact form submission.');
    cy.get('button[type="submit"]').click();

    cy.wait('@networkError');
    cy.contains('Network error').should('be.visible');
  });
});
