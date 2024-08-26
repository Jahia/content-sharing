package org.jahia.se.modules.contentSharing;

import org.jahia.bin.Render;
import org.jahia.osgi.BundleUtils;
import org.jahia.services.content.*;
import org.jahia.services.content.decorator.JCRSiteNode;
import org.jahia.services.render.RenderContext;
import org.jahia.services.render.RenderException;
import org.jahia.services.render.RenderService;
import org.jahia.services.render.Resource;
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;

import javax.jcr.RepositoryException;
import javax.jcr.query.Query;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Locale;
import java.util.Map;
import org.jahia.api.Constants;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Component(service = {javax.servlet.http.HttpServlet.class, javax.servlet.Servlet.class}, property = {"alias=/share", "allow-api-token=true"})
public class ContentSharingServlet extends HttpServlet {
    private static final Logger LOGGER = LoggerFactory.getLogger(ContentSharingServlet.class);

    private JCRTemplate jcrTemplate;
    private RenderService renderService;

    @Reference
    public void setJcrTemplate(JCRTemplate jcrTemplate) {
        this.jcrTemplate = jcrTemplate;
    }

    @Reference
    public void setRenderService(RenderService renderService) {
        this.renderService = renderService;
    }

    @Activate
    public void activate(Map<String, Object> config) {}

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
        String contentKey = request.getParameter("c");
        String contentType = request.getParameter("t");
        // Set the response content type
        response.setContentType("text/html");

        try {
            // Write response
            response.getWriter().println(jcrTemplate.doExecuteWithSystemSessionAsUser(null, Constants.LIVE_WORKSPACE, Locale.ENGLISH, new JCRCallback<String>() {
                    @Override
                    public String doInJCR(JCRSessionWrapper session) throws RepositoryException {
                        JCRNodeIteratorWrapper iteratorWrapper =  session.getWorkspace()
                                .getQueryManager()
                                .createQuery("SELECT * FROM ["+contentType+"] AS node WHERE node.[jcr:title] = '"+contentKey+"'", Query.JCR_SQL2)
                                .execute()
                                .getNodes();
                        if(iteratorWrapper.hasNext()){
                            JCRNodeWrapper node = (JCRNodeWrapper) iteratorWrapper.next();
    //                        session.getNodeByIdentifier(node.getIdentifier())

                            Resource r = new Resource(node, "html", "default", "page");
                            RenderContext renderContext = new RenderContext(request, response, JCRSessionFactory.getInstance().getCurrentUser());
                            renderContext.setMainResource(r);
//                            renderContext.setServletPath(Render.getRenderServletPath());
                            renderContext.setServletPath("/modules");
                            renderContext.setWorkspace(node.getSession().getWorkspace().getName());
                            JCRSiteNode site = node.getResolveSite();
                            renderContext.setSite(site);
                            try {
                                return renderService.render(r, renderContext);
                            } catch (RenderException e) {
                                throw new RuntimeException(e);
                            }

                        }
                        return null;
                    }
                })
            );
        } catch (RepositoryException e) {
            // Write response
            response.getWriter().println("<h1>Oups something wrong</h1>");
            LOGGER.error("Error retrieving site from node", e);
        }


    }

    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
        // Handle POST requests here
    }
}
